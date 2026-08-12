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

export const isPipelineSlot = (s: SlotLike): boolean =>
  !!(s.item_id ?? s.itemId) && !isRerunSlot(s);

// Does the cut have work to do here? (brief lines or re-runs on the lineup)
export const lineupNeedsCut = (slots: SlotLike[]): boolean =>
  slots.some(s => !isPipelineSlot(s));

// All-pipeline lineup = a launch, not a production release.
export const lineupIsPipelineOnly = (slots: SlotLike[]): boolean =>
  slots.length > 0 && slots.every(isPipelineSlot);
