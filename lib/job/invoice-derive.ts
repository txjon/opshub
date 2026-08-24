// Invoice DERIVE — pure view computations for the Invoice surface (staleness,
// aggregate paid/balance, fully-shipped, the state-rail step). No mutations, no
// JSX. Keeps the surface thin. NOTE: this is the VIEW-state math, distinct from
// the triplicated qty/total math in the QB/PDF/variance routes (that's the
// separate ticketed billing-derive extraction). See [[jon-clean-architecture-standard]].

export type InvoiceStep = "draft" | "sent" | "paid" | "reconcile" | "final";

export type InvoiceState = {
  qbInvoiceNumber: string | null;
  qbPaymentLink: string | null;
  qbInvoiceId: string | null;
  isManualInvoice: boolean;      // number set by hand, no QB invoice to update
  variancePushedAt: string | null;
  extraLines: any[];
  waivedAmount: number;          // closed-short residual (invoice_waived_amount)
  currentSubtotal: number;
  invoiceStale: boolean;         // current pricing drifted from the QB total
  aggInvoiceTotal: number;
  aggPaidSum: number;
  aggBalance: number;
  aggIsPartial: boolean;
  isPaid: boolean;
  isDropShip: boolean;
  isShipThrough: boolean;
  isFullyShipped: boolean;       // reconcile becomes available
  sentAt: string | null;
  step: InvoiceStep;             // where the invoice sits on the rail
};

export function deriveInvoice(job: any, items: any[] = [], payments: any[] = []): InvoiceState {
  const tm = job?.type_meta || {};
  const qbInvoiceNumber = tm.qb_invoice_number || null;
  const qbPaymentLink = tm.qb_payment_link || null;
  const qbInvoiceId = tm.qb_invoice_id || null;
  const isManualInvoice = !!qbInvoiceNumber && !qbInvoiceId;
  const variancePushedAt = tm.qb_variance_pushed_at || null;
  const sentAt = tm.invoice_sent_at || null;

  const extraLines = Array.isArray(tm.invoice_extra_lines) ? tm.invoice_extra_lines : [];
  const passthruTotal = Number(job?.costing_summary?.passthruTotal) || 0;
  const nonPassthruExtras = extraLines.filter((l: any) => l?.type !== "passthru").reduce((a: number, l: any) => a + (Number(l?.amount) || 0), 0);
  const currentSubtotal = (job?.costing_summary?.grossRev || 0) + passthruTotal + nonPassthruExtras;
  const qbSubtotal = (tm.qb_total_with_tax || 0) - (tm.qb_tax_amount || 0);
  const invoiceStale = !!qbInvoiceId && !variancePushedAt && Math.abs(currentSubtotal - qbSubtotal) > 0.01;

  const aggInvoiceTotal = Number(tm.qb_total_with_tax) || currentSubtotal || 0;
  const aggPaidSum = (payments || [])
    .filter((p: any) => p.status === "paid" || p.status === "partial")
    .reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
  // Closed-short waiver (Aug 24 2026): an owner can settle a residual we
  // won't collect (client shorted / chose not to bill actuals). The waived
  // amount reduces the balance — never recorded as a payment, so revenue
  // reports stay honest.
  const waivedAmount = Number(tm.invoice_waived_amount) || 0;
  const aggBalance = Math.max(0, aggInvoiceTotal - aggPaidSum - waivedAmount);
  const aggIsPartial = aggPaidSum > 0.01 && aggBalance > 0.01;
  const isPaid = aggBalance <= 0.01 && (aggPaidSum > 0.01 || waivedAmount > 0.01);

  const isDropShip = job?.shipping_route === "drop_ship";
  const isShipThrough = job?.shipping_route === "ship_through";
  // Fully-shipped is judged PER ITEM by the item's own route (mig 076 rule) —
  // the old job-level check meant MIXED-route jobs never satisfied either
  // branch and the reconcile card never showed (Financial V2 1e fix, Aug 24).
  // drop_ship item: decorator shipped it. warehouse item: it forwarded to the
  // client (or the job's fulfillment run shipped).
  const itemDelivered = (it: any) => {
    const r = it.shipping_route || job?.shipping_route;
    if (r === "ship_through" || r === "stage") return !!it.forwarded_at || job?.fulfillment_status === "shipped";
    return it.pipeline_stage === "shipped";
  };
  const isFullyShipped = items.length > 0 && items.every(itemDelivered);

  // Rail step — last matching line wins (higher precedence). Reconcile is an
  // action-needed state that surfaces after shipping until it's finalized.
  let step: InvoiceStep = "draft";
  if (qbInvoiceNumber && sentAt) step = "sent";
  if (isPaid) step = "paid";
  if (isFullyShipped && !variancePushedAt) step = "reconcile";
  if (variancePushedAt) step = "final";

  return {
    qbInvoiceNumber, qbPaymentLink, qbInvoiceId, isManualInvoice, variancePushedAt,
    extraLines, waivedAmount, currentSubtotal, invoiceStale,
    aggInvoiceTotal, aggPaidSum, aggBalance, aggIsPartial, isPaid,
    isDropShip, isShipThrough, isFullyShipped, sentAt, step,
  };
}
