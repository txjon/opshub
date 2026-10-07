// Production's "a client paid" email (Drake, Oct 2026: the QuickBooks
// receipts to hello@ don't say what the job is or what to do next).
//
// Called by every path that records a client payment (QB webhook2, manual
// sync-payment) AFTER the payment row is written and the phase recomputed.
// Those paths dedupe on the QB payment id before writing, so one payment
// sends one email. Never throws: a mail failure must not fail a payment.

import { sendInternalMail, type InternalEvent } from "./internal-mail";

const EARLY = new Set(["intake", "pending", "ready", "quoting", "approved"]);

export async function notifyClientPaid(db: any, jobId: string, amount: number): Promise<void> {
  try {
    const ev = await clientPaidEvent(db, jobId, amount);
    if (ev) await sendInternalMail(ev);
  } catch (e: any) {
    console.error("[payment-notify] failed:", e?.message || e);
  }
}

/** The facts for the email, read fresh after the payment is written. */
export async function clientPaidEvent(db: any, jobId: string, amount: number): Promise<InternalEvent | null> {
  const { data: job } = await db.from("jobs")
    .select("id, job_number, phase, qb_invoice_number, type_meta, costing_data, costing_summary, clients(name)")
    .eq("id", jobId).single();
  if (!job) return null;

  const { data: items } = await db.from("items")
    .select("id, name, sort_order, archived_at, buy_sheet_lines(qty_ordered)")
    .eq("job_id", jobId).is("archived_at", null).order("sort_order");
  const list = ((items || []) as any[]).map(it => ({
    id: it.id as string,
    name: (it.name || "Item") as string,
    units: ((it.buy_sheet_lines || []) as any[]).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0),
  }));

  const { data: pays } = await db.from("payment_records").select("amount, status").eq("job_id", jobId);
  const paidTotal = ((pays || []) as any[])
    .filter(p => p.status === "paid" || p.status === "partial")
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);
  // Same invoice total the payment classifier uses (webhook2 / sync-payment).
  const invoiceTotal = Number(job.type_meta?.qb_total_with_tax) || Number(job.costing_summary?.grossRev) || 0;

  // What's next: POs still to send → the order gate; POs out → production is
  // moving; complete → just settling the balance.
  const sent = new Set(((job.type_meta?.po_sent_vendors || []) as string[]).map(v => (v || "").toLowerCase().trim()));
  const liveIds = new Set(list.map(i => i.id));
  const vendors = new Set(((job.costing_data?.costProds || []) as any[])
    .filter(p => liveIds.has(p?.id) && p?.printVendor)
    .map(p => String(p.printVendor).toLowerCase().trim()));
  const unsent = Array.from(vendors).some(v => !sent.has(v));
  const stage: "needs_pos" | "in_motion" | "complete" =
    job.phase === "complete" ? "complete"
    : unsent || (vendors.size === 0 && sent.size === 0 && EARLY.has(job.phase)) ? "needs_pos"
    : "in_motion";

  return {
    kind: "client_paid",
    client: job.clients?.name || "Client",
    jobNumber: job.job_number,
    jobId: job.id,
    invoiceNumber: job.qb_invoice_number || null,
    amount: Number(amount) || 0,
    paidTotal,
    invoiceTotal,
    items: list.map(({ name, units }) => ({ name, units })),
    stage,
  };
}
