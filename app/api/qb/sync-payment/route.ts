export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getAccessToken } from "@/lib/quickbooks";

const QB_BASE_URL = "https://quickbooks.api.intuit.com";

// GET — list recent QB payments so you can find the right one
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const token = await getAccessToken();
    const realmId = process.env.QB_REALM_ID;

    // Query recent payments from QB (last 30 days)
    const query = encodeURIComponent("SELECT * FROM Payment WHERE MetaData.LastUpdatedTime > '2026-03-01' ORDERBY MetaData.LastUpdatedTime DESC MAXRESULTS 20");
    const res = await fetch(
      `${QB_BASE_URL}/v3/company/${realmId}/query?query=${query}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `QB API error: ${res.status}`, detail: text.slice(0, 500) }, { status: 500 });
    }

    const data = await res.json();
    const payments = data.QueryResponse?.Payment || [];

    // Format for easy reading
    const formatted = payments.map((p: any) => {
      const invoiceRefs = (p.Line || [])
        .filter((l: any) => l.LinkedTxn)
        .flatMap((l: any) => l.LinkedTxn)
        .filter((lt: any) => lt.TxnType === "Invoice")
        .map((lt: any) => lt.TxnId);

      return {
        paymentId: p.Id,
        amount: p.TotalAmt,
        date: p.TxnDate,
        customerName: p.CustomerRef?.name || p.CustomerRef?.value,
        linkedInvoiceIds: invoiceRefs,
        method: p.PaymentMethodRef?.name || "Unknown",
        memo: p.PrivateNote || null,
      };
    });

    return NextResponse.json({ payments: formatted, count: formatted.length });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// POST — process a specific payment ID (same logic as webhook)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { paymentId } = await req.json();
    if (!paymentId) return NextResponse.json({ error: "Missing paymentId" }, { status: 400 });

    const token = await getAccessToken();
    const realmId = process.env.QB_REALM_ID;
    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Fetch payment from QB
    const res = await fetch(
      `${QB_BASE_URL}/v3/company/${realmId}/payment/${paymentId}`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `QB API error: ${res.status}`, detail: text.slice(0, 500) }, { status: 500 });
    }

    const data = await res.json();
    const payment = data.Payment;
    if (!payment) return NextResponse.json({ error: "Payment not found in QB response" }, { status: 404 });

    const amount = payment.TotalAmt || 0;
    const invoiceRefs = (payment.Line || [])
      .filter((l: any) => l.LinkedTxn)
      .flatMap((l: any) => l.LinkedTxn)
      .filter((lt: any) => lt.TxnType === "Invoice")
      .map((lt: any) => lt.TxnId);

    if (invoiceRefs.length === 0) {
      return NextResponse.json({
        error: "No linked invoices on this payment",
        payment: { id: payment.Id, amount, customer: payment.CustomerRef?.name, date: payment.TxnDate },
      }, { status: 400 });
    }

    const results: any[] = [];

    for (const qbInvoiceId of invoiceRefs) {
      // Match by qb_invoice_id
      let { data: jobs } = await admin
        .from("jobs")
        .select("id, title, type_meta, clients(name)")
        .filter("type_meta->>qb_invoice_id", "eq", qbInvoiceId);

      // Fallback: match by qb_invoice_number
      if (!jobs?.length) {
        const { data: fallback } = await admin
          .from("jobs")
          .select("id, title, type_meta, clients(name)")
          .filter("type_meta->>qb_invoice_number", "eq", String(qbInvoiceId));
        if (fallback?.length) jobs = fallback;
      }

      if (!jobs?.length) {
        results.push({ qbInvoiceId, status: "no_match", error: "No job found for this QB invoice ID" });
        continue;
      }

      const job = jobs[0];

      // Check for existing payment
      const today = new Date().toISOString().split("T")[0];
      const { data: existing } = await admin
        .from("payment_records")
        .select("id")
        .eq("job_id", job.id)
        .eq("amount", amount)
        .eq("status", "paid");

      if (existing?.length) {
        results.push({ qbInvoiceId, jobId: job.id, jobTitle: job.title, status: "already_exists", paymentRecordId: existing[0].id });
        continue;
      }

      // Insert payment
      const { error: insertErr } = await admin.from("payment_records").insert({
        job_id: job.id,
        type: "payment",
        amount,
        status: "paid",
        paid_date: payment.TxnDate || today,
        invoice_number: (job.type_meta as any)?.qb_invoice_number || null,
      });

      if (insertErr) {
        results.push({ qbInvoiceId, jobId: job.id, status: "insert_error", error: insertErr.message });
        continue;
      }

      // Log activity + notify
      await admin.from("job_activity").insert({
        job_id: job.id, user_id: null, type: "auto",
        message: `Payment received — $${amount.toLocaleString()} via QuickBooks (manual sync)`,
      });

      const { data: profiles } = await admin.from("profiles").select("id");
      if (profiles?.length) {
        await admin.from("notifications").insert(
          profiles.map((p: any) => ({
            user_id: p.id, type: "payment",
            message: `Payment received — $${amount.toLocaleString()} · ${(job.clients as any)?.name || ""} · ${job.title}`,
            reference_id: job.id, reference_type: "job",
          }))
        );
      }

      results.push({ qbInvoiceId, jobId: job.id, jobTitle: job.title, status: "recorded", amount });
    }

    return NextResponse.json({ paymentId, amount, results });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
