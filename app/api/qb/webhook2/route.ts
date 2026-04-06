export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/quickbooks";
import { createHmac } from "crypto";
import { sendClientNotification } from "@/lib/auto-email";

const QB_BASE_URL = "https://quickbooks.api.intuit.com";

// Verify QB webhook signature
function verifySignature(payload: string, signature: string): boolean {
  const webhookVerifier = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
  if (!webhookVerifier) return true; // Skip verification if not configured
  const hash = createHmac("sha256", webhookVerifier).update(payload).digest("base64");
  return hash === signature;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("intuit-signature") || "";

    if (!verifySignature(rawBody, signature)) {
      console.error("[QB Webhook] Invalid signature");
      return NextResponse.json({ success: false }, { status: 401 });
    }

    const body = JSON.parse(rawBody);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // QB sends eventNotifications array
    const notifications = body.eventNotifications || [];

    for (const notification of notifications) {
      const realmId = notification.realmId;
      if (realmId !== process.env.QB_REALM_ID) continue;

      const events = notification.dataChangeEvent?.entities || [];

      for (const entity of events) {
        if (entity.name === "Payment") {
          const paymentId = entity.id;

          // Fetch payment details from QB
          const token = await getAccessToken();
          const res = await fetch(
            `${QB_BASE_URL}/v3/company/${realmId}/payment/${paymentId}`,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/json",
              },
            }
          );

          if (!res.ok) continue;
          const data = await res.json();
          const payment = data.Payment;
          if (!payment) continue;

          const amount = payment.TotalAmt || 0;

          // Find which invoice this payment is for
          const invoiceRefs = (payment.Line || [])
            .filter((l: any) => l.LinkedTxn)
            .flatMap((l: any) => l.LinkedTxn)
            .filter((lt: any) => lt.TxnType === "Invoice")
            .map((lt: any) => lt.TxnId);

          for (const qbInvoiceId of invoiceRefs) {
            // Find the job with this QB invoice ID
            const { data: jobs } = await supabase
              .from("jobs")
              .select("id, title, type_meta, phase, clients(name)")
              .filter("type_meta->>qb_invoice_id", "eq", qbInvoiceId);

            if (!jobs?.length) continue;
            const job = jobs[0];

            // Check if we already recorded this payment
            const { data: existing } = await supabase
              .from("payment_records")
              .select("id")
              .eq("job_id", job.id)
              .eq("type_meta->>qb_payment_id", paymentId);

            if (existing?.length) continue; // Already recorded

            // Record the payment
            await supabase.from("payment_records").insert({
              job_id: job.id,
              type: "payment",
              amount,
              status: "paid",
              paid_date: new Date().toISOString().split("T")[0],
              invoice_number: (job.type_meta as any)?.qb_invoice_number || null,
              type_meta: { qb_payment_id: paymentId },
            });

            // Log activity
            await supabase.from("job_activity").insert({
              job_id: job.id,
              user_id: null,
              type: "auto",
              message: `Payment received — $${amount.toLocaleString()} via QuickBooks`,
            });

            // Notify team
            const { data: profiles } = await supabase.from("profiles").select("id");
            if (profiles?.length) {
              await supabase.from("notifications").insert(
                profiles.map((p: any) => ({
                  user_id: p.id,
                  type: "payment",
                  message: `Payment received — $${amount.toLocaleString()} · ${(job.clients as any)?.name || ""} · ${job.title}`,
                  reference_id: job.id,
                  reference_type: "job",
                }))
              );
            }

            // Auto-email client payment confirmation (fire-and-forget)
            sendClientNotification({ jobId: job.id, type: "payment_received", amount }).catch(() => {});

            console.log(`[QB Webhook] Payment $${amount} recorded for job ${job.id}`);
          }
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[QB Webhook Error]", e);
    // Always return 200 to QB so they don't retry
    return NextResponse.json({ success: true });
  }
}
