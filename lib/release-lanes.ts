// Release lanes — the lineup decides (Jon, Aug 12 2026). A release is no
// longer born stock-or-preorder; each SLOT carries its lane and release
// behavior derives from the mix:
//
//   brief line  (brief_id, no item_id)        — needs design + a run
//   pipeline    (item_id, line_id "item:…")   — already made/in flight;
//                                               rides for launch timing only
//   re-run      (item_id, line_id "rerun:…")  — past catalog piece; design
//                                               exists (always ready) but the
//                                               cut births a fresh run of it
//
// The cut processes brief + re-run slots; pipeline slots are never re-made.
// A lineup that is ALL pipeline just launches — nothing to cut, no sale close.

export const isRerunLineId = (lineId?: string | null): boolean =>
  typeof lineId === "string" && lineId.startsWith("rerun:");

// Works on raw DB rows (line_id/item_id) and on the portal payload
// (lineId/itemId) so both sides of the glass share one rule.
type SlotLike = { line_id?: string | null; lineId?: string | null; item_id?: string | null; itemId?: string | null };

export const isRerunSlot = (s: SlotLike): boolean => isRerunLineId(s.line_id ?? s.lineId);

// Product lane (Continuum Phase 5, Aug 24 2026): an un-produced catalog
// product on the lineup — design approved by construction (products are
// born from comp-lineup picks on locked designs), no run yet. The cut/buy
// births its first run, stamping items.product_id.
export const isProductLineId = (lineId?: string | null): boolean =>
  typeof lineId === "string" && lineId.startsWith("product:");
export const productIdOfSlot = (s: SlotLike): string | null => {
  const l = s.line_id ?? s.lineId;
  return isProductLineId(l) ? String(l).slice(8) : null;
};
export const isProductSlot = (s: SlotLike): boolean => isProductLineId(s.line_id ?? s.lineId);

export const isPipelineSlot = (s: SlotLike): boolean =>
  !!(s.item_id ?? s.itemId) && !isRerunSlot(s);

// Does the cut have work to do here? (brief lines or re-runs on the lineup)
export const lineupNeedsCut = (slots: SlotLike[]): boolean =>
  slots.some(s => !isPipelineSlot(s));

// All-pipeline lineup = a launch, not a production release.
export const lineupIsPipelineOnly = (slots: SlotLike[]): boolean =>
  slots.length > 0 && slots.every(isPipelineSlot);

// ── Phase 1 (Aug 18 2026): ONE derivation for units, approval, and line
//    state. The internal board and the hub were each doing their own math —
//    the hub read the linked item's qty while the board summed the slot's
//    entered numbers (the 472-vs-1,412 drift), and the board's approval
//    check still used pre-rework brief states so approved designs rendered
//    "pending". Every release surface AND the cut route derive through
//    these; no surface reimplements a formula. ──────────────────────────

// Brief states that count as an approved design (mig 159 studio states).
export const BRIEF_APPROVED_STATES = ["approved"];
export const briefApproved = (state?: string | null): boolean =>
  BRIEF_APPROVED_STATES.includes(String(state || ""));

export type SizeQty = { size: string; qty: number };

/** Total units across a slot's entered per-size numbers. Integer-only. */
export const sumQtys = (qtys?: Record<string, unknown> | null): number =>
  Object.values(qtys || {}).reduce((a: number, b) => a + (Math.round(Number(b)) || 0), 0);

/** The slot's entered numbers as a size list (zero rows dropped). */
export const enteredSizes = (qtys?: Record<string, unknown> | null): SizeQty[] =>
  Object.entries(qtys || {})
    .map(([size, qty]) => ({ size, qty: Math.round(Number(qty)) || 0 }))
    .filter(s => s.qty > 0);

// Item shapes both sides produce: the hub items API sends sizes[]; the
// internal board joins buy_sheet_lines(size, qty_ordered) raw.
export type ItemLike = {
  qty?: number | null;
  sizes?: SizeQty[] | null;
  buy_sheet_lines?: { size: string; qty_ordered: unknown }[] | null;
  pipeline_stage?: string | null;
  received_at_hpd?: string | null;
  forwarded_at?: string | null;
  webstore_entered_at?: string | null;
} | null | undefined;

export const itemRunSizes = (item: ItemLike): SizeQty[] =>
  item?.sizes?.length
    ? item.sizes.filter(s => (s.qty || 0) > 0)
    : (item?.buy_sheet_lines || [])
        .map(l => ({ size: l.size, qty: Math.round(Number(l.qty_ordered)) || 0 }))
        .filter(s => s.qty > 0);

/**
 * THE quantity precedence rule. An item is this line's run when the slot is
 * a true pipeline slot, or once the release is cut (the cut re-stamps
 * item_id to the new run — before that, a re-run's item_id points at the
 * PAST run and the entered numbers are the new run's truth).
 */
export const lineUnits = (
  slot: SlotLike & { qtys?: Record<string, unknown> | null },
  item: ItemLike,
  releaseCut: boolean,
): { total: number; sizes: SizeQty[]; source: "item" | "slot" | "none" } => {
  const itemIsThisRun = !!(slot.item_id ?? slot.itemId) && (isPipelineSlot(slot) || releaseCut);
  if (itemIsThisRun && item) {
    const sizes = itemRunSizes(item);
    const total = sizes.length ? sizes.reduce((a, s) => a + s.qty, 0) : (Math.round(Number(item.qty)) || 0);
    if (total > 0) return { total, sizes, source: "item" };
  }
  const sizes = enteredSizes(slot.qtys);
  return { total: sumQtys(slot.qtys), sizes, source: sizes.length ? "slot" : "none" };
};

/** Cut gate: every line the cut will birth has entered numbers. */
export const releaseNumbersDone = (slots: (SlotLike & { qtys?: Record<string, unknown> | null })[]): boolean => {
  const cuttable = slots.filter(s => !isPipelineSlot(s));
  return cuttable.length > 0 && cuttable.every(s => sumQtys(s.qtys) > 0);
};

// ── Line state: one truth, two label registers ─────────────────────────
export type LineState =
  | "rerun_ready" | "design_pending" | "design_ready"
  | "on_press" | "in_transit" | "landed" | "in_store";

export const lineState = (
  slot: SlotLike,
  item: ItemLike,
  opts: { releaseCut: boolean; briefState?: string | null },
): LineState => {
  if (isRerunSlot(slot) && !opts.releaseCut) return "rerun_ready";
  if (!(slot.item_id ?? slot.itemId)) return briefApproved(opts.briefState) ? "design_ready" : "design_pending";
  const it = item || {};
  if (it.webstore_entered_at) return "in_store";
  if (it.received_at_hpd || it.forwarded_at) return "landed";
  if (it.pipeline_stage === "shipped") return "in_transit";
  return "on_press";
};

/** Has this line physically arrived (store or warehouse)? Drives "x/y landed". */
export const lineLanded = (state: LineState): boolean => state === "landed" || state === "in_store";

export type LineTone = "green" | "amber" | "blue" | "purple";
type LineLabel = { label: string; tone: LineTone };

/** internal = ops register; client = hub register. Same states, two voices. */
export const LINE_LABELS: Record<"internal" | "client", Record<LineState, LineLabel>> = {
  internal: {
    rerun_ready: { label: "Run it back ✓", tone: "green" },
    design_pending: { label: "Design pending", tone: "amber" },
    design_ready: { label: "Design ✓", tone: "green" },
    on_press: { label: "On press", tone: "blue" },
    in_transit: { label: "In transit", tone: "purple" },
    landed: { label: "Landed", tone: "green" },
    in_store: { label: "In store", tone: "green" },
  },
  client: {
    rerun_ready: { label: "Run it back", tone: "green" },
    design_pending: { label: "Design pending", tone: "amber" },
    design_ready: { label: "Design approved", tone: "green" },
    on_press: { label: "In production", tone: "blue" },
    in_transit: { label: "On its way", tone: "blue" },
    landed: { label: "Landed", tone: "green" },
    in_store: { label: "In your store", tone: "green" },
  },
};

// ── Phase 4 (Aug 20 2026): THE PRE-ORDER LEDGER. A line is a per-size
//    ledger of three numbers — sold (manual/import), bought (Σ linked buy
//    runs' curves), delivered (Σ received_qtys as buys land). Rolling buys
//    = N jobs per release via items.release_slot_id. Only sold is ever
//    typed by a human. ─────────────────────────────────────────────────

export type BuyItemLike = {
  buy_sheet_lines?: { size: string; qty_ordered: unknown }[] | null;
  received_qtys?: Record<string, unknown> | null;
};

export type Ledger = {
  sizes: string[];                       // union, caller sorts for display
  sold: Record<string, number>;
  bought: Record<string, number>;
  delivered: Record<string, number>;
  totals: { sold: number; bought: number; delivered: number };
};

const n = (v: unknown) => Math.max(0, Math.round(Number(v)) || 0);

export const buildLedger = (
  soldQtys: Record<string, unknown> | null | undefined,
  buyItems: BuyItemLike[],
): Ledger => {
  const sold: Record<string, number> = {};
  for (const [s, v] of Object.entries(soldQtys || {})) if (n(v) > 0) sold[s] = n(v);
  const bought: Record<string, number> = {};
  const delivered: Record<string, number> = {};
  for (const it of buyItems) {
    for (const l of (it.buy_sheet_lines || [])) bought[l.size] = (bought[l.size] || 0) + n(l.qty_ordered);
    for (const [s, v] of Object.entries(it.received_qtys || {})) delivered[s] = (delivered[s] || 0) + n(v);
  }
  const sizes = Array.from(new Set([...Object.keys(sold), ...Object.keys(bought), ...Object.keys(delivered)]));
  const tot = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);
  return { sizes, sold, bought, delivered, totals: { sold: tot(sold), bought: tot(bought), delivered: tot(delivered) } };
};

/** next_buy[size] = max(0, round(sold × (1 + overage%)) − bought). Integer-
 *  only; nearest-rounding verified against the Pre-Order Master sheet — it
 *  reproduces the real 2nd buy exactly where ceil over-suggests by one. */
export const suggestNextBuy = (ledger: Ledger, overagePct: number): Record<string, number> => {
  const pct = Math.max(0, Number(overagePct) || 0);
  const out: Record<string, number> = {};
  for (const s of Object.keys(ledger.sold)) {
    const want = Math.round(ledger.sold[s] * (1 + pct / 100));
    const need = Math.max(0, want - (ledger.bought[s] || 0));
    if (need > 0) out[s] = need;
  }
  return out;
};

/** A line is covered when every sold size has landed at least that many. */
export const lineCovered = (ledger: Ledger): boolean =>
  Object.keys(ledger.sold).every(s => (ledger.delivered[s] || 0) >= ledger.sold[s]);

/** Finished = window passed AND every line covered. daysToClose from lib/dates. */
export const releaseFinished = (daysToClose: number | null, ledgers: Ledger[]): boolean =>
  daysToClose != null && daysToClose < 0 && ledgers.length > 0 && ledgers.every(lineCovered);
