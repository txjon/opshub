// Invoice/payment ACTIONS — the money-mutation layer for a job.
// Extracted from PaymentTab so surfaces stay thin (view calls these, no
// business logic in JSX). The API routes (/api/qb/invoice, /api/qb/refresh-link,
// /api/email/send, /api/pdf/invoice) remain the real logic; these are the
// client-side orchestration + the Supabase writes + activity/notify side effects.
// See [[jon-clean-architecture-standard]]. NOTE: the triplicated qty/total math
// in the QB/PDF/variance routes is a SEPARATE, ticketed extraction (billing-derive).
import { createClient } from "@/lib/supabase/client";
import { logJobActivity, notifyTeam } from "@/components/JobActivityPanel";

const today = () => new Date().toISOString().split("T")[0];

export type QBPushResult =
  | { ok: true; data: any }
  | { ok: false; ambiguous: any[] };

// Create or update the QuickBooks invoice. Returns {ok:true,data} on success,
// or {ok:false,ambiguous} when QB needs the caller to pick a customer (409).
// Throws on hard failure. Caller owns loading/error state + onUpdateJob/onReload.
export async function pushInvoiceToQB(job: any, opts: { qbCustomerId?: string; forceCreate?: boolean } = {}): Promise<QBPushResult> {
  const body: any = { jobId: job.id };
  if (opts.qbCustomerId) body.qbCustomerId = opts.qbCustomerId;
  if (opts.forceCreate) body.forceCreate = true;
  const res = await fetch("/api/qb/invoice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A platform-level failure (Vercel timeout/crash) returns a plain-text
  // page — parsing it as JSON produced "Unexpected token 'A'…" gibberish
  // in the UI (Sep 1). Guard the parse and say what actually happened.
  const data = await res.json().catch(() => ({
    error: `QuickBooks push failed (server ${res.status}) — QB may be slow or down; try again in a few minutes.`,
  }));
  if (res.status === 409 && data?.error === "ambiguous_customer") {
    return { ok: false, ambiguous: data.candidates || [] };
  }
  if (!res.ok) throw new Error(data.error || "Failed to push to QuickBooks");
  if (data.updated) logJobActivity(job.id, `QB Invoice #${data.invoiceNumber} updated with new pricing`);
  else logJobActivity(job.id, `Invoice #${data.invoiceNumber} created in QuickBooks`);
  return { ok: true, data };
}

// Regenerate the QB hosted payment link. Returns the fresh URL or throws.
export async function refreshPayLink(job: any): Promise<string> {
  const res = await fetch("/api/qb/refresh-link", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId: job.id }),
  });
  const data = await res.json();
  if (!res.ok || !data.paymentLink) throw new Error(data.error || "QuickBooks did not return a payment link.");
  logJobActivity(job.id, "QB payment link refreshed");
  return data.paymentLink;
}

// Clear the client's cached QB customer link (next push re-runs smart match).
export async function unlinkQBCustomer(job: any): Promise<void> {
  const res = await fetch("/api/qb/link-customer", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId: job.client_id, qbCustomerId: null }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Unlink failed");
}

// Record a payment. status='paid'. Auto-approves the quote if not already
// (recording a payment is implicit approval — unblocks Send PO / Order Blanks).
export async function recordPayment(job: any, p: { type: string; amount: number; invoice_number: string | null; paid_date: string }): Promise<void> {
  const supabase = createClient();
  await supabase.from("payment_records").insert({ job_id: job.id, type: p.type, amount: p.amount, invoice_number: p.invoice_number, status: "paid", paid_date: p.paid_date } as any);
  logJobActivity(job.id, `Payment received: ${p.type.replace(/_/g, " ")} — $${p.amount.toLocaleString()}${p.invoice_number ? ` (${p.invoice_number})` : ""}`);
  notifyTeam(`Payment received — $${p.amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
  await autoApproveViaPayment(job);
}

// Cycle a payment row's status pending → paid → void → pending. Returns the new status.
export async function cyclePaymentStatus(job: any, payment: any): Promise<string> {
  const supabase = createClient();
  const statuses = ["pending", "paid", "void"];
  const idx = statuses.indexOf(payment.status);
  const ns = statuses[(idx + 1) % statuses.length];
  await supabase.from("payment_records").update({ status: ns, paid_date: ns === "paid" ? today() : null }).eq("id", payment.id);
  logJobActivity(job.id, `Payment ${payment.invoice_number || "#"} status → ${ns}${ns === "paid" ? " — $" + payment.amount.toLocaleString() : ""}`);
  if (ns === "paid") {
    notifyTeam(`Payment received — $${payment.amount.toLocaleString()} · ${job.clients?.name || ""} · ${job.title}`, "payment", job.id, "job");
    await autoApproveViaPayment(job);
  }
  return ns;
}

export async function deletePayment(id: string): Promise<void> {
  const supabase = createClient();
  await supabase.from("payment_records").delete().eq("id", id);
}

// Persist a type_meta patch (invoice date override, manual invoice #). Returns
// the merged type_meta so the caller can push it into local job state.
export async function patchTypeMeta(job: any, patch: Record<string, any>, opts: { logMsg?: string } = {}): Promise<any> {
  const supabase = createClient();
  const next = { ...(job.type_meta || {}) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete next[k];
    else next[k] = v;
  }
  await supabase.from("jobs").update({ type_meta: next }).eq("id", job.id);
  if (opts.logMsg) logJobActivity(job.id, opts.logMsg);
  return next;
}

// Recording a payment implies the quote is approved — flip the gate so
// downstream alerts can fire without a separate "Approve Quote" click.
async function autoApproveViaPayment(job: any): Promise<void> {
  if (job.quote_approved) return;
  const supabase = createClient();
  await supabase.from("jobs").update({
    quote_approved: true,
    quote_approved_at: new Date().toISOString(),
    quote_rejection_notes: null,
  }).eq("id", job.id);
  logJobActivity(job.id, "Quote auto-approved via payment");
}
