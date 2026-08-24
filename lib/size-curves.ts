// Size-curve seeding (Continuum Phase 3, Aug 24 2026).
//
// Clients type ONE total; the curve is ops judgment (Jon: "they're paying us
// to do it"). When a cart order lands, the intake job's buy_sheet_lines are
// auto-seeded down a specificity chain so the team ADJUSTS a sane curve
// instead of typing one:
//   1. the item's own last-run curve, scaled to the requested total
//   2. the client's aggregate curve for the garment group
//   3. the global curve for the group (all clients)
//   4. sized-garment fallback / one-size goods: a single line
// Every seed is provisional — callers stamp provenance into item notes.

export type SizeQty = { size: string; qty: number };

// Sized-apparel groups (mirrors god-mode's curve universe: hats, stickers,
// one-size goods have no curve to speak of).
const SIZED: Record<string, string> = {
  tee: "Tees", longsleeve: "Tees", hoodie: "Hoodies", crewneck: "Crewneck",
  jacket: "Jacket", pants: "Pants", shorts: "Shorts", jersey: "Jersey",
};
export const garmentGroup = (garmentType?: string | null): string | null =>
  SIZED[String(garmentType || "").toLowerCase()] || null;

/** Largest-remainder apportionment: scale a curve to an exact new total.
 *  Zero/empty base or total → []. Result always sums to exactly `total`. */
export function scaleCurve(base: SizeQty[], total: number): SizeQty[] {
  const t = Math.max(0, Math.round(Number(total) || 0));
  const clean = (base || []).filter(b => (Number(b.qty) || 0) > 0);
  const baseTotal = clean.reduce((a, b) => a + Number(b.qty), 0);
  if (!t || !clean.length || !baseTotal) return [];
  const exact = clean.map(b => ({ size: b.size, x: (Number(b.qty) / baseTotal) * t }));
  const floors = exact.map(e => ({ size: e.size, qty: Math.floor(e.x), rem: e.x - Math.floor(e.x) }));
  let left = t - floors.reduce((a, f) => a + f.qty, 0);
  // hand out remainders largest-first; stable on ties by base order
  const order = floors.map((f, i) => ({ i, rem: f.rem })).sort((a, b) => b.rem - a.rem || a.i - b.i);
  for (const o of order) { if (left <= 0) break; floors[o.i].qty += 1; left -= 1; }
  return floors.filter(f => f.qty > 0).map(f => ({ size: f.size, qty: f.qty }));
}

/** Aggregate a set of buy_sheet_lines rows into a normalized curve. */
export function aggregateCurve(rows: { size: string; qty_ordered: unknown }[]): SizeQty[] {
  const acc: Record<string, number> = {};
  for (const r of rows || []) {
    const q = Math.round(Number(r.qty_ordered)) || 0;
    if (q > 0) acc[r.size] = (acc[r.size] || 0) + q;
  }
  return Object.entries(acc).map(([size, qty]) => ({ size, qty }));
}

/** Client-then-global curve for a garment group, from live buy_sheet_lines.
 *  Returns { curve, source } — source names the tier for provenance notes. */
export async function groupCurve(db: any, clientId: string, group: string):
  Promise<{ curve: SizeQty[]; source: "client history" | "house curve" | null }> {
  const types = Object.entries(SIZED).filter(([, g]) => g === group).map(([t]) => t);
  if (!types.length) return { curve: [], source: null };
  const { data: mine } = await db.from("items")
    .select("garment_type, jobs!inner(client_id), buy_sheet_lines(size, qty_ordered)")
    .eq("jobs.client_id", clientId).in("garment_type", types).limit(300);
  const mineCurve = aggregateCurve((mine || []).flatMap((it: any) => it.buy_sheet_lines || []));
  if (mineCurve.length) return { curve: mineCurve, source: "client history" };
  const { data: all } = await db.from("items")
    .select("garment_type, buy_sheet_lines(size, qty_ordered)")
    .in("garment_type", types).limit(600);
  const allCurve = aggregateCurve((all || []).flatMap((it: any) => it.buy_sheet_lines || []));
  return allCurve.length ? { curve: allCurve, source: "house curve" } : { curve: [], source: null };
}

/** Free-text product format ("Black Hoodie", "heavyweight tee") → curve group. */
export function formatGroup(format?: string | null): string | null {
  const f = String(format || "").toLowerCase();
  if (!f) return null;
  if (/hood/.test(f)) return "Hoodies";
  if (/crew/.test(f)) return "Crewneck";
  if (/jacket|windbreaker|coach/.test(f)) return "Jacket";
  if (/jersey/.test(f)) return "Jersey";
  if (/pant|jean|jogger/.test(f)) return "Pants";
  if (/short(?!s? ?sleeve)/.test(f)) return "Shorts";
  if (/tee|t-?shirt|long ?sleeve|\bls\b/.test(f)) return "Tees";
  return null;
}
