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
  const aggBalance = Math.max(0, aggInvoiceTotal - aggPaidSum);
  const aggIsPartial = aggPaidSum > 0.01 && aggBalance > 0.01;
  const isPaid = aggPaidSum > 0.01 && aggBalance <= 0.01;

  const isDropShip = job?.shipping_route === "drop_ship";
  const isShipThrough = job?.shipping_route === "ship_through";
  const allItemsShipped = items.length > 0 && items.every((it: any) => it.pipeline_stage === "shipped");
  const isFullyShipped = (isDropShip && allItemsShipped) || (isShipThrough && job?.fulfillment_status === "shipped");

  // Rail step — last matching line wins (higher precedence). Reconcile is an
  // action-needed state that surfaces after shipping until it's finalized.
  let step: InvoiceStep = "draft";
  if (qbInvoiceNumber && sentAt) step = "sent";
  if (isPaid) step = "paid";
  if (isFullyShipped && !variancePushedAt) step = "reconcile";
  if (variancePushedAt) step = "final";

  return {
    qbInvoiceNumber, qbPaymentLink, qbInvoiceId, isManualInvoice, variancePushedAt,
    extraLines, currentSubtotal, invoiceStale,
    aggInvoiceTotal, aggPaidSum, aggBalance, aggIsPartial, isPaid,
    isDropShip, isShipThrough, isFullyShipped, sentAt, step,
  };
}
