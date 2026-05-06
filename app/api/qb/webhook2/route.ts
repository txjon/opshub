export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/quickbooks";
import { createHmac } from "crypto";
import { sendClientNotification } from "@/lib/auto-email";
import { appBaseUrl } from "@/lib/public-url";
import { derivePaymentType } from "@/lib/payment-status";

const QB_BASE_URL = "https://quickbooks.api.intuit.com";

function verifySignature(payload: string, signature: string): boolean {
  const webhookVerifier = process.env.QB_WEBHOOK_VERIFIER_TOKEN;
  if (!webhookVerifier) return true;
  const hash = createHmac("sha256", webhookVerifier).update(payload).digest("base64");
  return hash === signature;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get("intuit-signature") || "";

    console.log("[QB Webhook2] POST received, body length:", rawBody.length);

    if (!verifySignature(rawBody, signature)) {
      console.error("[QB Webhook2] HMAC signature mismatch");
      return NextResponse.json({ success: true });
    }

    const body = JSON.parse(rawBody);
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const notifications = body.eventNotifications || [];
    console.log("[QB Webhook2] Notifications:", notifications.length);

    for (const notification of notifications) {
      const realmId = notification.realmId;
      if (realmId !== process.env.QB_REALM_ID) {
        console.error("[QB Webhook2] Realm mismatch:", realmId, "!==", process.env.QB_REALM_ID);
        continue;
      }

      const events = notification.dataChangeEvent?.entities || [];
      console.log("[QB Webhook2] Entities:", events.map((e: any) => `${e.name}:${e.id}`).join(", "));

      for (const entity of events) {
        if (entity.name !== "Payment") continue;
        const paymentId = entity.id;
        console.log("[QB Webhook2] Processing payment:", paymentId);

        // Fetch payment details from QB
        let token: string;
        try {
          token = await getAccessToken();
        } catch (e: any) {
          console.error("[QB Webhook2] Token refresh FAILED:", e.message);
          continue;
        }

        const res = await fetch(
          `${QB_BASE_URL}/v3/company/${realmId}/payment/${paymentId}`,
          { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
        );

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          console.error("[QB Webhook2] QB API error fetching payment:", res.status, errText.slice(0, 300));
          // Retry with fresh token
          try {
            const freshToken = await getAccessToken();
            const retry = await fetch(
              `${QB_BASE_URL}/v3/company/${realmId}/payment/${paymentId}`,
              { headers: { Authorization: `Bearer ${freshToken}`, Accept: "application/json" } }
            );
            if (!retry.ok) {
              console.error("[QB Webhook2] Retry also failed:", retry.status);
              continue;
            }
            const retryData = await retry.json();
            await processPayment(retryData.Payment, supabase, paymentId);
          } catch (retryErr: any) {
            console.error("[QB Webhook2] Retry exception:", retryErr.message);
          }
          continue;
        }

        const data = await res.json();
        await processPayment(data.Payment, supabase, paymentId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (e: any) {
    console.error("[QB Webhook2] Top-level error:", e.message, e.stack?.slice(0, 300));
    return NextResponse.json({ success: true });
  }
}

async function processPayment(payment: any, supabase: any, paymentId: string) {
  if (!payment) {
    console.error("[QB Webhook2] Payment object is null for ID:", paymentId);
    return;
  }

  const amount = payment.TotalAmt || 0;
  console.log("[QB Webhook2] Payment amount:", amount, "CustomerRef:", payment.CustomerRef?.value);

  // Find linked invoice IDs
  const invoiceRefs = (payment.Line || [])
    .filter((l: any) => l.LinkedTxn)
    .flatMap((l: any) => l.LinkedTxn)
    .filter((lt: any) => lt.TxnType === "Invoice")
    .map((lt: any) => lt.TxnId);

  console.log("[QB Webhook2] Linked invoice IDs:", invoiceRefs.join(", ") || "NONE");

  if (invoiceRefs.length === 0) {
    // Fallback: try to match by customer name or payment memo
    console.error("[QB Webhook2] No linked invoices found — payment cannot be matched");
    return;
  }

  for (const qbInvoiceId of invoiceRefs) {
    // Primary match: by qb_invoice_id
    let { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, type_meta, phase, costing_summary, clients(name)")
      .filter("type_meta->>qb_invoice_id", "eq", qbInvoiceId);

    // Fallback match: by qb_invoice_number (in case ID wasn't saved)
    if (!jobs?.length) {
      console.log("[QB Webhook2] No match on qb_invoice_id:", qbInvoiceId, "— trying invoice number");
      const { data: fallback } = await supabase
        .from("jobs")
        .select("id, title, type_meta, phase, costing_summary, clients(name)")
        .filter("type_meta->>qb_invoice_number", "eq", String(qbInvoiceId));
      if (fallback?.length) jobs = fallback;
    }

    if (!jobs?.length) {
      // Not a job invoice — try matching to a ShipStation sales report
      // (fulfillment fee invoice pushed from /reports/shipstation/...).
      const handled = await tryMatchShipstationReport(supabase, qbInvoiceId, amount);
      if (handled) continue;
      console.error("[QB Webhook2] NO JOB OR REPORT FOUND for QB invoice:", qbInvoiceId);
      continue;
    }

    const job = jobs[0];
    console.log("[QB Webhook2] Matched job:", job.id, job.title);

    // Dedup: check if already recorded. Match across status values so a
    // partial-then-final pattern doesn't double-record the same QB hit.
    const today = new Date().toISOString().split("T")[0];
    const { data: existing } = await supabase
      .from("payment_records")
      .select("id")
      .eq("job_id", job.id)
      .eq("amount", amount)
      .eq("paid_date", today);

    if (existing?.length) {
      console.log("[QB Webhook2] Duplicate — already recorded for job:", job.id);
      continue;
    }

    // Classify this payment as deposit / balance / full_payment based
    // on prior paid records vs invoice total. This is what makes the
    // project-list and detail aggregates show "Partial Paid" correctly
    // when QB processes a partial payment against an invoice.
    const { data: priorPays } = await supabase
      .from("payment_records")
      .select("amount, status")
      .eq("job_id", job.id);
    const priorPaidTotal = (priorPays || [])
      .filter((p: any) => p.status === "paid" || p.status === "partial")
      .reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
    const invoiceTotal = Number((job.type_meta as any)?.qb_total_with_tax)
      || Number((job as any).costing_summary?.grossRev)
      || 0;
    const paymentType = derivePaymentType({ newAmount: amount, priorPaidTotal, invoiceTotal });

    // Record the payment. The row-level status stays "paid" (this slice
    // was received in full); the project-level partial state is
    // computed from sum vs total at read time.
    const { error: insertErr } = await supabase.from("payment_records").insert({
      job_id: job.id,
      type: paymentType,
      amount,
      status: "paid",
      paid_date: today,
      invoice_number: (job.type_meta as any)?.qb_invoice_number || null,
    });

    if (insertErr) {
      console.error("[QB Webhook2] INSERT FAILED:", insertErr.message, insertErr.details);
      continue;
    }

    // Log activity
    await supabase.from("job_activity").insert({
      job_id: job.id,
      user_id: null,
      type: "auto",
      message: `Payment received — $${amount.toLocaleString()} via QuickBooks`,
    });

    // Notifications table deprecated — bell UI was removed.

    // Auto-email client with PAID-stamped invoice PDF
    (async () => {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(process.env.RESEND_API_KEY);
        // Get client email (prefer billing, then primary, then any)
        const { data: contacts } = await supabase.from("job_contacts").select("role_on_job, contacts(email, name)").eq("job_id", job.id);
        const billing = contacts?.find((c: any) => c.role_on_job === "billing")?.contacts;
        const primary = contacts?.find((c: any) => c.role_on_job === "primary")?.contacts;
        const anyContact = contacts?.map((c: any) => c.contacts).find((c: any) => c?.email);
        const clientEmail = billing?.email || primary?.email || anyContact?.email;
        if (!clientEmail) {
          console.error("[QB Webhook2] No client email found for job:", job.id);
          return;
        }

        // Fetch PAID-stamped invoice PDF — self-fetch uses internal URL
        const internalBase = process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
        const pdfRes = await fetch(`${internalBase}/api/pdf/invoice/${job.id}?paid=true&paidDate=${encodeURIComponent(new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }))}`, {
          headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! },
        });
        if (!pdfRes.ok) {
          const errText = await pdfRes.text().catch(() => "");
          console.error("[QB Webhook2] PAID invoice PDF fetch failed:", pdfRes.status, errText.slice(0, 200));
          return;
        }
        const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

        // Get portal URL — Client Hub when the client is flagged, else
        // legacy per-job portal.
        const { data: jobFull } = await supabase.from("jobs").select("id, portal_token, job_number, clients(portal_token, client_hub_enabled)").eq("id", job.id).single();
        const jobClient = (jobFull as any)?.clients;
        const portalUrl = jobClient?.client_hub_enabled && jobClient?.portal_token
          ? `${await appBaseUrl()}/portal/client/${jobClient.portal_token}/orders/${(jobFull as any).id}`
          : (jobFull?.portal_token ? `${await appBaseUrl()}/portal/${jobFull.portal_token}` : "");
        const portalButton = portalUrl ? `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">View in Portal</a></p>` : "";
        const invoiceNum = (job.type_meta as any)?.qb_invoice_number || jobFull?.job_number || "";

        const { error: sendErr } = await resend.emails.send({
          from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
          to: clientEmail,
          subject: `Payment received — ${(job.clients as any)?.name || ""}${invoiceNum ? ` · Invoice ${invoiceNum}` : ""} · ${job.title}`,
          html: `<p>Hi,</p><p>Payment of <strong>$${amount.toLocaleString()}</strong> received for <strong>Invoice ${invoiceNum} · ${job.title}</strong>. Your paid invoice is attached for your records.</p>${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`,
          attachments: [{ filename: `HPD-Invoice-${invoiceNum}-PAID.pdf`, content: pdfBuffer.toString("base64") }],
        });
        if (sendErr) {
          console.error("[QB Webhook2] Resend error:", sendErr);
        } else {
          console.log(`[QB Webhook2] PAID email sent to ${clientEmail} for ${job.title}`);
        }
      } catch (emailErr) {
        console.error("[QB Webhook2] Payment email exception:", emailErr);
      }
    })();

    console.log(`[QB Webhook2] SUCCESS — $${amount} recorded for "${job.title}" (${job.id})`);
  }
}

// Match a QB invoice ID (or doc number) against shipstation_reports and
// record the payment there. Returns true if handled so the caller can
// skip the "no job found" error.
async function tryMatchShipstationReport(supabase: any, qbInvoiceId: string, amount: number): Promise<boolean> {
  let { data: reports } = await supabase
    .from("shipstation_reports")
    .select("id, client_id, period_label, qb_invoice_number, qb_total_with_tax, totals, paid_at, paid_amount, clients(name)")
    .eq("qb_invoice_id", qbInvoiceId);

  if (!reports?.length) {
    const { data: fallback } = await supabase
      .from("shipstation_reports")
      .select("id, client_id, period_label, qb_invoice_number, qb_total_with_tax, totals, paid_at, paid_amount, clients(name)")
      .eq("qb_invoice_number", String(qbInvoiceId));
    if (fallback?.length) reports = fallback;
  }

  if (!reports?.length) return false;

  const report = reports[0];
  console.log("[QB Webhook2] Matched ShipStation report:", report.id, report.period_label);

  // Idempotency — if already marked paid for this amount, skip.
  const alreadyPaid = Number(report.paid_amount) || 0;
  if (report.paid_at && Math.abs(alreadyPaid - amount) < 0.01) {
    console.log("[QB Webhook2] Report payment already recorded");
    return true;
  }

  const { error: updErr } = await supabase.from("shipstation_reports").update({
    paid_at: new Date().toISOString(),
    paid_amount: amount,
  }).eq("id", report.id);

  if (updErr) {
    console.error("[QB Webhook2] Report update failed:", updErr.message);
    return true; // we did match it — don't let caller log "not found"
  }

  // Email the client a paid-receipt for the report. Best-effort — fire
  // and forget so a Resend outage doesn't break the webhook response.
  (async () => {
    try {
      const { data: contacts } = await supabase
        .from("contacts")
        .select("email, name, is_primary")
        .eq("client_id", report.client_id);
      const primary = contacts?.find((c: any) => c.is_primary)?.email;
      const anyEmail = contacts?.map((c: any) => c.email).find(Boolean);
      const clientEmail = primary || anyEmail;
      if (!clientEmail) {
        console.error("[QB Webhook2] No client email for ShipStation report:", report.id);
        return;
      }

      const { Resend } = await import("resend");
      const resend = new Resend(process.env.RESEND_API_KEY);
      const clientName = (report.clients as any)?.name || "";
      const invoiceNum = report.qb_invoice_number || "";
      const reportLabel = report.report_type === "combined"
        ? "Full Service Invoice"
        : report.report_type === "postage"
          ? "Fulfillment Invoice"
          : "Services Invoice";
      const { error: sendErr } = await resend.emails.send({
        from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
        to: clientEmail,
        subject: `Payment received — ${clientName}${invoiceNum ? ` · Invoice ${invoiceNum}` : ""} · ${report.period_label}`,
        html: `<p>Hi,</p><p>Payment of <strong>$${amount.toLocaleString()}</strong> received for <strong>${report.period_label} ${reportLabel}${invoiceNum ? ` (Invoice #${invoiceNum})` : ""}</strong>. Thanks for your business.</p><p>Welcome to the party,<br/>House Party Distro</p>`,
      });
      if (sendErr) console.error("[QB Webhook2] Report paid email Resend error:", sendErr);
      else console.log(`[QB Webhook2] Report paid email sent to ${clientEmail}`);
    } catch (e) {
      console.error("[QB Webhook2] Report paid email exception:", e);
    }
  })();

  console.log(`[QB Webhook2] SUCCESS — $${amount} recorded for ShipStation report ${report.id}`);
  return true;
}
