// Payment classification helpers — single source of truth for both
// QB webhook → payment_records writes and the project-list aggregate
// pill. Schema constraints (migration 001):
//   payment_records.type   IN ('deposit','balance','full_payment','refund')
//   payment_records.status IN ('draft','sent','viewed','partial','paid','overdue','void')

export type PaymentType = "deposit" | "balance" | "full_payment" | "refund";
export type AggregatePaymentStatus =
  | "paid"        // total billed has been fully collected
  | "partial"     // some collected, balance outstanding
  | "unpaid"      // invoiced but no payments collected
  | "none";       // no invoice issued yet (no signal)

// Tolerance for "close enough to paid" — covers QB processing fees,
// merchant-side credit-card rounding, and the cents-level shortfalls
// that aren't real outstanding balances. Anything ≥ $0.50 short is
// still treated as a real partial payment.
const EPSILON = 0.5;

/**
 * Classify a brand-new payment row given the prior state on the job.
 *
 *   - deposit       — the project still has an unpaid balance after
 *                     this payment is applied (amount partially covers
 *                     the invoice total)
 *   - balance       — this payment closes the invoice AND there were
 *                     earlier paid records (i.e. the final installment
 *                     of a multi-payment invoice)
 *   - full_payment  — this payment closes the invoice AND there were
 *                     no earlier paid records (a single-shot payoff)
 */
export function derivePaymentType(args: {
  newAmount: number;
  priorPaidTotal: number;
  invoiceTotal: number;
}): PaymentType {
  const newAmount = Number(args.newAmount) || 0;
  const priorPaidTotal = Number(args.priorPaidTotal) || 0;
  const invoiceTotal = Number(args.invoiceTotal) || 0;

  // No invoice total to compare against — fall back to the legacy
  // behavior so we don't regress jobs without saved totals.
  if (invoiceTotal <= EPSILON) return "full_payment";

  const cumulative = priorPaidTotal + newAmount;
  const closesInvoice = cumulative >= invoiceTotal - EPSILON;

  if (!closesInvoice) return "deposit";
  if (priorPaidTotal > EPSILON) return "balance";
  return "full_payment";
}

/**
 * Compute the project-level payment status from the row-level records
 * + the invoice total. Used by the projects list pill, dashboard
 * widgets, and anywhere else we need a single answer for "is this
 * project paid?". Replaces the old `some(p.status === "paid")` test
 * which couldn't distinguish a $1 payment on a $100K invoice from a
 * full payoff.
 */
export function deriveAggregateStatus(args: {
  payments: Array<{ amount: number | null; status: string | null }>;
  invoiceTotal: number;
}): AggregatePaymentStatus {
  const total = Number(args.invoiceTotal) || 0;

  // Sum any record that's been collected. "partial" status is included
  // for hand-entered partial payments — the row's status describes the
  // slice itself, not the project.
  const paidAmount = (args.payments || [])
    .filter(p => p.status === "paid" || p.status === "partial")
    .reduce((a, p) => a + (Number(p.amount) || 0), 0);

  // Has any invoice slice been issued (sent / viewed / paid / etc.)?
  // Used to distinguish "unpaid" (invoice out, awaiting payment) from
  // "none" (nothing billed yet — no payment expectation).
  const hasIssued = (args.payments || []).some(p =>
    p.status && !["draft", "void"].includes(p.status)
  );

  if (total <= EPSILON) return "none";
  if (paidAmount > EPSILON && total - paidAmount <= EPSILON) return "paid";
  if (paidAmount > EPSILON) return "partial";
  if (hasIssued) return "unpaid";
  return "none";
}
