// AR spine (Financial V2 Phase 1a, Aug 24 2026 — docs/financial-v2-phase1-
// invoices.md). ONE module for every derived AR number: the /invoices index,
// God Mode's aging + cash forecast (swap in 1e), and the dashboard alerts.
//
// Rules (spec):
// - Job-stream state = invoice-derive's rail step VERBATIM (imported).
// - Uninvoiced jobs are NOT rows. pnlJobs policy applies. Cancelled excluded.
// - Fulfillment stream = isInvoicedReport rows; both streams are equals.
// - Aging is DERIVED, never read from stored payment status. Waiting inside
//   net terms is on_terms — normal, not a problem.
import { deriveInvoice, type InvoiceStep } from "@/lib/job/invoice-derive";
import { pnlJobs } from "@/lib/revenue";
import { isInvoicedReport, ssRevCost, ssReportLabel } from "@/lib/analytics";

export type ArAging = "not_due" | "on_terms" | "overdue_30" | "overdue_60" | "overdue_90";

export type InvoiceRow = {
  stream: "job" | "fulfillment";
  id: string;
  href: string;
  clientId: string;
  clientName: string;
  label: string;
  invoiceNumber: string | null;
  state: InvoiceStep | "ss_paid";
  billed: number;
  paid: number;
  balance: number;
  date: string;                 // invoice/report date (sort + display)
  dueDate: string | null;       // explicit unpaid due date when one exists
  expectedDate: string | null;  // terms-aware expected-payment date (forecast chain)
  aging: ArAging;
  // Close-out inputs (job stream; Phase 1c) — the queue derives from these.
  phase?: string;
  jobNumber?: string | null;
  fullyShipped?: boolean;
  financialClosedAt?: string | null;
  payLink?: string | null;      // QB hosted pay page (reminder/copy actions)
  waived?: number;              // closed-short residual
};

export type ArSummary = {
  rows: InvoiceRow[];
  kpis: { outstanding: number; overdue: number; onTerms: number; expected30: number };
  aging: Record<ArAging, { count: number; total: number }>;
};

// God Mode's terms table, ported verbatim (spec 1a: port INTO this lib).
const TERMS_DAYS: Record<string, number> = {
  net_15: 15, net_30: 30, net_60: 60,
  prepaid: -14, deposit_balance: -7, due_on_receipt: 0,
};
const MS_DAY = 86400000;
const r2 = (n: number) => Math.round(n * 100) / 100;

function agingOf(balance: number, due: Date | null, expected: Date | null, now: Date): ArAging {
  if (balance <= 0.01) return "not_due";
  const anchor = due || expected;
  if (!anchor) return "on_terms";
  const daysOver = Math.floor((now.getTime() - anchor.getTime()) / MS_DAY);
  if (daysOver <= 0) return due ? "not_due" : "on_terms";
  if (daysOver <= 30) return "overdue_30";
  if (daysOver <= 60) return "overdue_60";
  return "overdue_90";
}

export function buildAr(opts: {
  jobs: any[];
  itemsByJob: Record<string, any[]>;
  paymentsByJob: Record<string, any[]>;
  clients: { id: string; name: string; default_terms?: string | null }[];
  ssReports: any[];
  now?: Date;
}): ArSummary {
  const now = opts.now || new Date();
  const clientById: Record<string, any> = {};
  for (const c of opts.clients || []) clientById[c.id] = c;

  const rows: InvoiceRow[] = [];

  // ── Job stream ──
  for (const j of pnlJobs(opts.jobs || [])) {
    if (j.phase === "cancelled") continue;
    const tm = j.type_meta || {};
    if (!tm.qb_invoice_number) continue; // uninvoiced jobs are alerts, not rows
    const payments = opts.paymentsByJob[j.id] || [];
    const d = deriveInvoice(j, opts.itemsByJob[j.id] || [], payments);

    // Expected-payment chain (God Mode forecast logic, ported):
    // earliest unpaid due date → target_ship + terms → created + terms.
    const unpaidWithDue = payments
      .filter((p: any) => p.status !== "paid" && p.status !== "void" && p.due_date)
      .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)));
    let due: Date | null = null;
    let expected: Date;
    if (unpaidWithDue.length > 0) {
      due = new Date(unpaidWithDue[0].due_date);
      expected = due;
    } else if (j.target_ship_date) {
      const delay = TERMS_DAYS[j.payment_terms as string] ?? 30;
      expected = new Date(new Date(j.target_ship_date).getTime() + delay * MS_DAY);
    } else {
      const delay = TERMS_DAYS[j.payment_terms as string] ?? 30;
      expected = new Date(new Date(j.created_at).getTime() + delay * MS_DAY);
    }

    const balance = r2(d.aggBalance);
    rows.push({
      stream: "job",
      id: j.id,
      href: `/jobs/${j.id}?tab=invoice`,
      clientId: j.client_id,
      clientName: clientById[j.client_id]?.name || (j.clients as any)?.name || "—",
      label: j.title || j.job_number || "Job",
      invoiceNumber: d.qbInvoiceNumber,
      state: d.step,
      billed: r2(d.aggInvoiceTotal),
      paid: r2(d.aggPaidSum),
      balance,
      date: tm.invoice_sent_at || j.created_at,
      dueDate: due ? due.toISOString().slice(0, 10) : null,
      expectedDate: expected.toISOString().slice(0, 10),
      aging: agingOf(balance, due, expected, now),
      phase: j.phase,
      jobNumber: j.job_number || null,
      fullyShipped: d.isFullyShipped,
      financialClosedAt: j.financial_closed_at || null,
      payLink: tm.qb_payment_link || null,
      waived: d.waivedAmount,
    });
  }

  // ── Fulfillment stream (ShipStation reports) ──
  for (const r of opts.ssReports || []) {
    if (!isInvoicedReport(r)) continue;
    const billed = r2(Number(r.qb_total_with_tax) || ssRevCost(r).revenue || 0);
    if (billed <= 0) continue;
    const paid = r.paid_at ? r2(Number(r.paid_amount) || billed) : 0;
    const balance = r2(Math.max(0, billed - paid));
    const client = clientById[r.client_id];
    // Terms offsets are for the job forecast chain (anchored on ship dates);
    // negative ones (prepaid −14) are nonsense against a report's own date —
    // a period invoice can't be expected before it exists. Clamp to ≥0 and
    // anchor on the send when there's been one (the clock starts when the
    // client is actually billed).
    const delay = Math.max(0, TERMS_DAYS[(client?.default_terms) as string] ?? 30);
    const expected = new Date(new Date(r.sent_at || r.created_at).getTime() + delay * MS_DAY);
    rows.push({
      stream: "fulfillment",
      id: r.id,
      href: `/invoices/fulfillment/${r.id}`, // moves to /invoices/fulfillment in 1d
      clientId: r.client_id,
      clientName: client?.name || "—",
      label: `${ssReportLabel(r.report_type)}${r.period_label ? ` · ${r.period_label}` : ""}`,
      invoiceNumber: r.qb_invoice_number || null,
      // sent_at is what separates a generated-but-unsent invoice from a
      // billed one — without it every unpaid report read as SENT (Sep 1).
      state: r.paid_at ? "ss_paid" : r.sent_at ? "sent" : "draft",
      billed,
      paid,
      balance,
      date: r.sent_at || r.created_at,
      dueDate: null,
      expectedDate: expected.toISOString().slice(0, 10),
      aging: agingOf(balance, null, expected, now),
      payLink: r.qb_payment_link || null,
    });
  }

  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const aging: Record<ArAging, { count: number; total: number }> = {
    not_due: { count: 0, total: 0 }, on_terms: { count: 0, total: 0 },
    overdue_30: { count: 0, total: 0 }, overdue_60: { count: 0, total: 0 }, overdue_90: { count: 0, total: 0 },
  };
  let outstanding = 0, overdue = 0, onTerms = 0, expected30 = 0;
  const horizon = new Date(now.getTime() + 30 * MS_DAY).toISOString().slice(0, 10);
  for (const row of rows) {
    if (row.balance <= 0.01) continue;
    outstanding += row.balance;
    aging[row.aging].count++;
    aging[row.aging].total = r2(aging[row.aging].total + row.balance);
    if (row.aging.startsWith("overdue")) overdue += row.balance;
    else onTerms += row.balance;
    if (row.expectedDate && row.expectedDate <= horizon) expected30 += row.balance;
  }
  return {
    rows,
    kpis: { outstanding: r2(outstanding), overdue: r2(overdue), onTerms: r2(onTerms), expected30: r2(expected30) },
    aging,
  };
}

/** Close-out queue rule (Phase 1c, locked 2026-08-13): complete + Final
 *  (or Paid where no reconcile was required) + zero balance + cost-complete.
 *  Freight NEVER gates (the billing queue already excludes freight sources).
 *  Cost-complete is supplied by the caller from lib/billing-queue. */
export function isCloseable(row: InvoiceRow, costComplete: boolean): boolean {
  if (row.stream !== "job" || row.financialClosedAt) return false;
  if (row.phase !== "complete") return false;
  const invoiceDone = row.state === "final" || (row.state === "paid" && !row.fullyShipped);
  return invoiceDone && row.balance <= 0.01 && costComplete;
}
