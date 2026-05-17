// Item status — the one source of truth.
//
// Every page in OpsHub (and the client portal) computes an item's
// status by calling computeItemStatus(). One function, one
// vocabulary, same answer everywhere. No more "the same item shows
// Delivered on the portal and In Production on the project page."
//
// 5 active states + Archived + 2 modifiers:
//
//   setup          — default. Pre-PO. Costing, art, payment, blanks.
//   in_production  — PO sent, decorator hasn't shipped yet.
//   shipped        — Left decorator, in transit to HPD. (Drop-ship
//                    items skip this — they go straight to complete
//                    because the decorator ships direct to client.)
//   in_stock       — Received at HPD warehouse. Sitting, waiting on
//                    next action (retail release for stage route, or
//                    outbound forwarding for ship-through).
//   complete       — HPD's last shipping action taken.
//   archived       — Complete + grace period elapsed, or manually
//                    archived, or job cancelled. Hidden from active views.
//   on_hold        — Job is on_hold. Overlay over the current state.
//   cancelled      — Job cancelled. Auto-archives.
//
// The grace period (default 30 days) means a recently-Complete item
// still shows in active views — Jon doesn't lose visibility of what
// just wrapped. Clients see it for a few weeks then it drops to
// their History tab.

export type ItemState =
  | "setup"
  | "in_production"
  | "shipped"
  | "in_stock"
  | "complete"
  | "archived"
  | "on_hold"
  | "cancelled";

export const ACTIVE_STATES: ItemState[] = ["setup", "in_production", "shipped", "in_stock", "complete"];
export const HISTORICAL_STATES: ItemState[] = ["archived", "cancelled"];

// Days an item stays in Complete before auto-archiving.
export const ARCHIVE_GRACE_DAYS = 30;

export interface ItemStatusInput {
  // From the item row
  archived_at?: string | null;
  pipeline_stage?: string | null;
  received_at_hpd?: boolean | null;
  sell_per_unit?: number | null;
  blanks_order_cost?: number | null;
  // From the parent job
  job_phase?: string | null;
  job_shipping_route?: string | null;
  job_quote_approved?: boolean | null;
  // Optional: was a PO sent to this item's decorator? When unknown,
  // we infer from pipeline_stage (in_production / shipped both imply
  // a PO was sent).
  po_sent?: boolean | null;
}

export function computeItemStatus(input: ItemStatusInput): ItemState {
  const phase = input.job_phase || "";
  const ps = input.pipeline_stage || null;
  const route = input.job_shipping_route || null;

  // Manual archive or cancelled jobs → archived (terminal historical)
  if (input.archived_at) return "archived";
  if (phase === "cancelled") return "cancelled";

  // On-hold overlay — preserves underlying progress but shown as on_hold
  if (phase === "on_hold") return "on_hold";

  // Job phase complete — item is at minimum Complete. Check for auto-archive.
  if (phase === "complete") {
    return "complete";
  }

  // Per-item production states (most specific signal)
  if (ps === "shipped") {
    // Drop-ship: decorator's tracking IS the customer delivery. Item
    // is Complete from HPD's side as soon as the decorator ships.
    if (route === "drop_ship") return "complete";
    // Ship-through / stage: once HPD has received the item it's
    // physically in our warehouse waiting on next action (retail
    // release for stage, outbound forwarding for ship_through).
    // Distinguishes "in transit to HPD" from "at HPD, waiting."
    if (input.received_at_hpd) return "in_stock";
    return "shipped";
  }
  if (ps === "in_production" || ps === "strike_off") return "in_production";

  // PO sent but no pipeline_stage set yet → still In Production
  if (input.po_sent) return "in_production";

  // Job-wide signal: job is in production/receiving/fulfillment but
  // this item has no per-item pipeline_stage. Fall back to In
  // Production so it shows in active production views.
  if (phase === "production" || phase === "receiving" || phase === "fulfillment") {
    return "in_production";
  }

  // Default — everything pre-PO is Setup, regardless of how much
  // setup work has been done (costing, art, blanks ordering). Those
  // are gates, not states.
  return "setup";
}

// Determine if a Complete item should be considered Archived based on
// time elapsed since the job's completion. Used by render-time
// auto-archiving when archived_at hasn't been written eagerly.
export function isPastArchiveGrace(jobCompletedAt: string | null | undefined): boolean {
  if (!jobCompletedAt) return false;
  const completedTime = new Date(jobCompletedAt).getTime();
  if (!Number.isFinite(completedTime)) return false;
  const days = (Date.now() - completedTime) / 86400000;
  return days >= ARCHIVE_GRACE_DAYS;
}

// Full status resolver that includes the grace-period auto-archive
// check. Most callers should use this.
export function resolveItemStatus(input: ItemStatusInput & { job_completed_at?: string | null }): ItemState {
  const base = computeItemStatus(input);
  if (base === "complete" && isPastArchiveGrace(input.job_completed_at)) {
    return "archived";
  }
  return base;
}

// Labels — one set of words, used everywhere a user sees status.
// No per-audience translation. If we want different wording per
// surface later, we can extend; the default policy is consistency.
export const STATE_LABELS: Record<ItemState, string> = {
  setup: "Setup",
  in_production: "In Production",
  shipped: "Shipped",
  in_stock: "In Stock",
  complete: "Complete",
  archived: "Archived",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

// Semantic color band per state. Callers map this onto their own
// palette (T.* for internal, C.* for portal).
export type ColorBand = "muted" | "blue" | "purple" | "teal" | "green" | "faint" | "amber" | "red";

export const STATE_COLOR_BANDS: Record<ItemState, ColorBand> = {
  setup: "muted",
  in_production: "blue",
  shipped: "purple",
  in_stock: "teal",
  complete: "green",
  archived: "faint",
  on_hold: "amber",
  cancelled: "red",
};

export function isActive(state: ItemState): boolean {
  return ACTIVE_STATES.includes(state);
}

export function isHistorical(state: ItemState): boolean {
  return HISTORICAL_STATES.includes(state);
}
