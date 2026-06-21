export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { voidInvoice } from "@/lib/quickbooks";

// Cancel a job and void its QuickBooks invoice — for a job that was invoiced
// then cancelled by the client BEFORE payment. Voids (not deletes) so the QB
// doc number stays in the audit trail at $0. Refuses if any payment exists,
// checked BOTH in OpsHub (payment_records) and live in QB (voidInvoice balance).
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: job } = await admin.from("jobs").select("id, title, job_number, phase, type_meta, phase_timestamps").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const tm = (job.type_meta as any) || {};
    const qbInvoiceId = tm.qb_invoice_id || null;
    const qbInvoiceNumber = tm.qb_invoice_number || null;

    // OpsHub-side payment gate: a real payment is a paid/partial record with
    // a non-zero amount. The "sent" placeholder row (created on invoice push)
    // is NOT a payment.
    const { data: pays } = await admin.from("payment_records").select("amount, status").eq("job_id", jobId);
    const paid = (pays || []).filter((p: any) => (p.status === "paid" || p.status === "partial") && (Number(p.amount) || 0) > 0);
    if (paid.length > 0) {
      const total = paid.reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
      return NextResponse.json({ error: `Payment of $${total.toFixed(2)} is recorded on this job — cannot void. Refund/handle the payment first.` }, { status: 409 });
    }

    // Void in QB (also enforces the live-balance gate). Skip cleanly if there's
    // no API-linked invoice: a manual invoice number (no qb_invoice_id) can't be
    // voided via API — tell the user to void it in QB by hand.
    let voidResult: any = null;
    if (qbInvoiceId) {
      try {
        voidResult = await voidInvoice(qbInvoiceId);
      } catch (e: any) {
        return NextResponse.json({ error: e.message || "Failed to void QB invoice" }, { status: 409 });
      }
    } else if (qbInvoiceNumber) {
      return NextResponse.json({ error: `Invoice #${qbInvoiceNumber} was entered manually (no API link) — void it directly in QuickBooks, then cancel the job.` }, { status: 409 });
    }

    // Mark the job cancelled, preserving the invoice number + a voided stamp for
    // the record. Keep phase_timestamps consistent with other terminal moves.
    const newMeta = { ...tm, qb_invoice_voided_at: new Date().toISOString() };
    const phaseTs = { ...(((job as any).phase_timestamps) || {}), cancelled: new Date().toISOString() };
    await admin.from("jobs").update({ phase: "cancelled", type_meta: newMeta, phase_timestamps: phaseTs }).eq("id", jobId);

    await admin.from("job_activity").insert({
      job_id: jobId, user_id: user.id, type: "auto",
      message: qbInvoiceId
        ? (voidResult?.alreadyVoid
            ? `Job cancelled — QB invoice ${qbInvoiceNumber ? "#" + qbInvoiceNumber : ""} was already voided`
            : `Job cancelled — QB invoice ${qbInvoiceNumber ? "#" + qbInvoiceNumber : ""} voided in QuickBooks`)
        : "Job cancelled (no QB invoice to void)",
    });

    return NextResponse.json({ success: true, voided: !!voidResult?.voided, alreadyVoid: !!voidResult?.alreadyVoid });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
