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
  { k: "fulfillment", label: "Staging", tail: true },
];

// Which tail pages each route NEVER passes through (rendered dead/dashed).
export const ROUTE_DEAD: Record<string, ProjMilestone[]> = {
  drop_ship: ["receiving", "shipping", "fulfillment"], // vendor → client direct
  ship_through: ["fulfillment"],                       // Receiving → Shipping (forward)
  stage: ["shipping"],                                 // Receiving → Fulfillment (Shopify)
};

// The current milestone's signal: act = HPD's move (amber), wait = on the client
// or a vendor, nothing for us to do (hollow), late = overdue past threshold (red).
export type ProjSignal = "act" | "wait" | "late";
export type ProjStage = {
  complete: boolean;
  preQuote: boolean;
  milestone: ProjMilestone | null; // null when preQuote or complete
  now: string;                     // label for the "Now" column
  detail: string;                  // sub-state (from phase engine or gate)
  signal: ProjSignal;              // colors the current segment + strip edge
  reason: string;                  // blocker / next-move text
  route: string;                   // drop_ship / ship_through / stage
};

const STALE_QUOTE_DAYS = 3; // quote out this long with no approval → late (red)

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
  // Use the STORED job.phase — it carries the detailed lifecycle (production /
  // receiving / shipping / fulfillment). The new phase-model engine is coarse
  // (in_production) and can't distinguish the warehouse tail this board needs.
  const phaseKey: string = job.phase || "intake";
  const detail = phaseView?.detail || phaseView?.result?.job?.detail || "";
  const mk = (milestone: ProjMilestone | null, now: string, signal: ProjSignal, reason = "", det = detail): ProjStage =>
    ({ complete: false, preQuote: false, milestone, now, detail: det, signal, reason, route });

  if (job.phase === "complete" || phaseKey === "complete")
    return { complete: true, preQuote: false, milestone: null, now: "Complete", detail: "", signal: "act", reason: "", route };

  // ── warehouse tail: HPD's move once goods move through the building ──
  // (no overdue rule yet — needs per-phase-enter timestamps + Jon's thresholds)
  if (phaseKey === "fulfillment") return mk("fulfillment", "Staging", "act", "Key into Shopify / stage");
  if (phaseKey === "shipping") return mk("shipping", "Shipping", "act", "Forward to client");
  if (phaseKey === "receiving") return mk("receiving", "Receiving", "act", "Receive & forward");
  if (phaseKey === "production") {
    const late = shipTargetPast(job);
    return mk("production", "Production", late ? "late" : "wait", late ? "Overdue at decorator" : "At decorator");
  }

  // ── front of the spine: derive from the client/money gates ──
  const quoteSent = !!tm.quote_sent_at;
  const approved = !!job.quote_approved;
  const invoiceSent = !!(job as any).invoice_sent || !!tm.qb_invoice_number;
  const paid = (payments || []).some((p: any) => p.status === "paid");
  const posSent = ((tm.po_sent_vendors || []) as any[]).length > 0;
  const blanksOrdered = items.length > 0 && items.every((it: any) => it.blanks_order_cost != null || it.blanks_order_number);

  if (!quoteSent) return { complete: false, preQuote: true, milestone: null, now: preQuoteStep(job, items), detail: "", signal: "act", reason: "", route };
  if (!approved) {
    const d = daysSince(tm.quote_sent_at);
    const late = d != null && d >= STALE_QUOTE_DAYS;
    return mk("quote_appr", "Approved", late ? "late" : "wait", late ? `No approval — quote sent ${d}d ago` : "Awaiting approval", "awaiting approval");
  }
  if (!invoiceSent) return mk("invoice", "Invoice", "act", "Send invoice", "ready to invoice");   // HPD's move
  if (!paid) return mk("paid", "Paid", "wait", "Awaiting payment");                               // client's move
  if (!posSent || !blanksOrdered)
    return mk("order", "PO / Blanks", "act", !blanksOrdered ? "Order blanks" : "Send POs");        // HPD's move
  return mk("production", "Production", "wait", "At decorator"); // paid + ordered, at the decorator
}
