// Server read layer — loads the movement ledger and returns the DERIVED state
// (lib/item-derivation) for an item, a whole job, or a shipment's contents.
// This is the ONE place surfaces read order-state from. No writes here.
//
// Route resolution: item.shipping_route wins, else the job's shipping_route,
// else ship_through (the safe default — comes to HPD).

import { deriveItem, type ItemState, type Movement, type Route, type SizeQtys } from "./item-derivation";

type Sb = any; // Supabase client (project convention: loose typing at the boundary)

// display fields carried alongside the derived state, for list rows
export type ItemView = ItemState & {
  itemId: string;
  jobId: string;
  name: string;
  mockupColor: string | null;
};

const resolveRoute = (itemRoute: string | null, jobRoute: string | null): Route =>
  (itemRoute || jobRoute || "ship_through") as Route;

function orderedFrom(lines: { size: string; qty_ordered: number | null }[]): SizeQtys {
  const out: SizeQtys = {};
  for (const l of lines || []) { const q = Number(l.qty_ordered) || 0; if (q) out[l.size] = (out[l.size] || 0) + q; }
  return out;
}

const toMovement = (m: any): Movement => ({
  type: m.type, qtys: m.qtys || {}, shipmentId: m.shipment_id, reversesId: m.reverses_id, id: m.id,
});

// ── one item ─────────────────────────────────────────────────────────────
export async function loadItemState(sb: Sb, itemId: string): Promise<ItemView | null> {
  const { data: item } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, shipping_route, ship_final, jobs(shipping_route), buy_sheet_lines(size, qty_ordered)")
    .eq("id", itemId).single();
  if (!item) return null;

  const { data: movements } = await sb
    .from("movements").select("id, type, qtys, shipment_id, reverses_id").eq("item_id", itemId);

  const state = deriveItem({
    ordered: orderedFrom(item.buy_sheet_lines || []),
    route: resolveRoute(item.shipping_route, item.jobs?.shipping_route),
    shipFinal: !!item.ship_final,
    movements: (movements || []).map(toMovement),
  });
  return { ...state, itemId: item.id, jobId: item.job_id, name: item.name, mockupColor: item.mockup_color };
}

// ── many items at once (batched — for a job or a shipment view) ────────────
async function deriveItemsBatch(sb: Sb, items: any[]): Promise<ItemView[]> {
  if (!items.length) return [];
  const ids = items.map(i => i.id);
  const { data: allMoves } = await sb
    .from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", ids);
  const byItem = new Map<string, Movement[]>();
  for (const m of allMoves || []) {
    const arr = byItem.get(m.item_id) || []; arr.push(toMovement(m)); byItem.set(m.item_id, arr);
  }
  return items.map(item => {
    const state = deriveItem({
      ordered: orderedFrom(item.buy_sheet_lines || []),
      route: resolveRoute(item.shipping_route, item.jobs?.shipping_route),
      shipFinal: !!item.ship_final,
      movements: byItem.get(item.id) || [],
    });
    return { ...state, itemId: item.id, jobId: item.job_id, name: item.name, mockupColor: item.mockup_color };
  });
}

// ── a whole job (per-item states + rollup) ─────────────────────────────────
export type JobState = {
  jobId: string;
  items: ItemView[];
  itemCount: number;
  doneCount: number;
  allDone: boolean;                 // every item reached its route endpoint → job complete
  owedTotal: number;                // units still to be shipped across the job
  shortageTotal: number;            // real shorts across the job
  needsAttention: boolean;          // any size-mismatch flag
};

export async function loadJobState(sb: Sb, jobId: string): Promise<JobState> {
  const { data: items } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, shipping_route, ship_final, jobs(shipping_route), buy_sheet_lines(size, qty_ordered)")
    .eq("job_id", jobId).order("sort_order", { ascending: true });
  const views = await deriveItemsBatch(sb, items || []);
  const doneCount = views.filter(v => v.done).length;
  return {
    jobId,
    items: views,
    itemCount: views.length,
    doneCount,
    allDone: views.length > 0 && doneCount === views.length,
    owedTotal: views.reduce((a, v) => a + v.owedTotal, 0),
    shortageTotal: views.reduce((a, v) => a + v.shortageTotal, 0),
    needsAttention: views.some(v => v.sizeMismatchFlag),
  };
}

// ── a shipment's contents (the by-shipment view — receiving) ───────────────
// Every item that has a movement in this shipment/box, with its full state.
export async function loadShipmentItems(sb: Sb, shipmentId: string): Promise<ItemView[]> {
  const { data: moves } = await sb.from("movements").select("item_id").eq("shipment_id", shipmentId);
  const itemIds = Array.from(new Set((moves || []).map((m: any) => m.item_id).filter(Boolean)));
  if (!itemIds.length) return [];
  const { data: items } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, shipping_route, ship_final, jobs(shipping_route), buy_sheet_lines(size, qty_ordered)")
    .in("id", itemIds);
  return deriveItemsBatch(sb, items || []);
}
