// Projects Board V2 — turn a job's real state into a milestone on the board spine.
// Front of the spine (Quote+Proofs → Order) is derived from the gate fields;
// the warehouse tail (Production → Fulfillment) trusts the phase engine
// (lib/lifecycle via loadJobPhasesBatch). Complete drops off the active bar
// (jobs bucket by client instead). See [[opshub-project-board-v2]].

export type ProjMilestone =
  | "quote_sent" | "quote_appr" | "invoice" | "paid" | "order"
  | "production" | "receiving" | "shipping" | "fulfillment";

// The board spine, in order (Complete is intentionally NOT here — completed jobs
// leave the active board and group by client).
export const PROJ_MILESTONES: { k: ProjMilestone; label: string; tail?: boolean }[] = [
  { k: "quote_sent", label: "Quote + Proofs" },
  { k: "quote_appr", label: "Approved" },
  { k: "invoice", label: "Invoice" },
  { k: "paid", label: "Paid" },
  { k: "order", label: "PO / Blanks" },
  { k: "production", label: "Production" },
  { k: "receiving", label: "Receiving", tail: true },
  { k: "shipping", label: "Shipping", tail: true },
  { k: "fulfillment", label: "Fulfillment", tail: true },
];

// Which tail pages each route NEVER passes through (rendered dead/dashed).
export const ROUTE_DEAD: Record<string, ProjMilestone[]> = {
  drop_ship: ["receiving", "shipping", "fulfillment"], // vendor → client direct
  ship_through: ["fulfillment"],                       // Receiving → Shipping (forward)
  stage: ["shipping"],                                 // Receiving → Fulfillment (Shopify)
};

export type ProjAction = { lvl: "red" | "amber"; reason: string } | null;
export type ProjStage = {
  complete: boolean;
  preQuote: boolean;
  milestone: ProjMilestone | null; // null when preQuote or complete
  now: string;                     // label for the "Now" column
  detail: string;                  // sub-state (from phase engine or gate)
  action: ProjAction;
  route: string;                   // drop_ship / ship_through / stage
};

const daysSince = (ts: string | null | undefined): number | null => {
  if (!ts) return null;
  return Math.floor((Date.now() - new Date(ts).getTime()) / 86400000);
};

// Earliest agreed vendor ship date (for overdue signal in production).
function shipTargetPast(job: any): boolean {
  const tm = job.type_meta || {};
  const dates: string[] = Object.values(tm.po_ship_dates || {}).filter(Boolean) as string[];
  const one = tm.in_hands_date || tm.show_date || dates.sort()[0];
  if (!one) return false;
  return new Date(one).getTime() < Date.now();
}

function preQuoteStep(job: any, items: any[]): string {
  if (!items.length) return "Building buy sheet";
  if ((job.costing_summary as any)?.grossRev > 0) return "Costing — ready to quote";
  return "Art & costing";
}

export function deriveProjectStage(job: any, phaseView: any | undefined, items: any[], payments: any[]): ProjStage {
  const tm = job.type_meta || {};
  const route = job.shipping_route || "ship_through";
  const phaseKey: string = phaseView?.result?.job?.key || job.phase || "intake";
  const detail = phaseView?.detail || phaseView?.result?.job?.detail || "";
  const mk = (milestone: ProjMilestone | null, now: string, action: ProjAction = null, det = detail): ProjStage =>
    ({ complete: false, preQuote: false, milestone, now, detail: det, action, route });

  if (job.phase === "complete" || phaseKey === "complete")
    return { complete: true, preQuote: false, milestone: null, now: "Complete", detail: "", action: null, route };

  // ── warehouse tail: trust the phase engine ──
  if (phaseKey === "fulfillment") return mk("fulfillment", "Fulfillment");
  if (phaseKey === "shipping") return mk("shipping", "Shipping");
  if (phaseKey === "receiving") return mk("receiving", "Receiving");
  if (phaseKey === "production")
    return mk("production", "Production", shipTargetPast(job) ? { lvl: "red", reason: "Overdue at decorator" } : null);

  // ── front of the spine: derive from the client/money gates ──
  const quoteSent = !!tm.quote_sent_at;
  const approved = !!job.quote_approved;
  const invoiceSent = !!(job as any).invoice_sent || !!tm.qb_invoice_number;
  const paid = (payments || []).some((p: any) => p.status === "paid");
  const posSent = ((tm.po_sent_vendors || []) as any[]).length > 0;
  const blanksOrdered = items.length > 0 && items.every((it: any) => it.blanks_order_cost != null || it.blanks_order_number);

  if (!quoteSent) return { complete: false, preQuote: true, milestone: null, now: preQuoteStep(job, items), detail: "", action: null, route };
  if (!approved) {
    const d = daysSince(tm.quote_sent_at);
    return mk("quote_appr", "Approved", d != null && d >= 2 ? { lvl: "red", reason: `Quote sent ${d}d ago — no approval` } : null, "awaiting approval");
  }
  if (!invoiceSent) return mk("invoice", "Invoice", null, "ready to invoice");
  if (!paid) return mk("paid", "Paid", { lvl: "amber", reason: "Awaiting payment" }, "");
  if (!posSent || !blanksOrdered)
    return mk("order", "PO / Blanks", { lvl: "amber", reason: !blanksOrdered ? "Blanks not ordered" : "POs not sent" }, "");
  return mk("production", "Production"); // paid + ordered, heading to the decorator
}
