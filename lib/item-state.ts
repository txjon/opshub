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

// ── the Production board (job × vendor strips) ─────────────────────────────
// Items in the shipping window (ordered, not yet done by their route), grouped
// into strips of one job × one vendor — the unit you ship from. A box is one
// vendor, so a strip's selected items become one shipment.
export type BoardItem = ItemView & {
  decoratorId: string | null;
  decoratorName: string | null;
  decoratorCode: string | null;
  garmentType: string | null;
};
export type BoardStrip = {
  key: string;                 // jobId::decoratorId
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  jobRoute: Route; phase: string; priority: string | null; shipDate: string | null;
  decoratorId: string | null; decoratorName: string; decoratorCode: string | null;
  items: BoardItem[];
};

const ACTIVE_PHASES = ["ready", "production", "receiving", "shipping", "fulfillment", "on_hold"];

export async function loadProductionBoard(sb: Sb): Promise<BoardStrip[]> {
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, job_number, title, phase, priority, target_ship_date, shipping_route, clients(name)")
    .in("phase", ACTIVE_PHASES);
  const jobById = new Map<string, any>((jobs || []).map((j: any) => [j.id, j]));
  if (!jobById.size) return [];

  const { data: items } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, garment_type, shipping_route, ship_final, sort_order, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id, decorators(name, short_code))")
    .in("job_id", Array.from(jobById.keys()));
  if (!items?.length) return [];

  // batch movements
  const ids = items.map((i: any) => i.id);
  const { data: allMoves } = await sb
    .from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", ids);
  const byItem = new Map<string, Movement[]>();
  for (const m of allMoves || []) { const a = byItem.get(m.item_id) || []; a.push(toMovement(m)); byItem.set(m.item_id, a); }

  const strips = new Map<string, BoardStrip>();
  for (const item of items) {
    const job = jobById.get(item.job_id); if (!job) continue;
    const jobRoute = resolveRoute(item.shipping_route, job.shipping_route);
    const state = deriveItem({
      ordered: orderedFrom(item.buy_sheet_lines || []),
      route: jobRoute,
      shipFinal: !!item.ship_final,
      movements: byItem.get(item.id) || [],
    });
    // Production holds only what still has units to ship FROM production. Once
    // closed (fully shipped or marked final), it's left production — Receiving
    // owns it now. in_production / partially_shipped stay (ship the next wave).
    if (state.closed || state.orderedTotal === 0) continue;

    const assign = (item.decorator_assignments || [])[0] || {};
    const decoratorId = assign.decorator_id || null;
    const decoratorName = assign.decorators?.name || "Unassigned vendor";
    const key = `${item.job_id}::${decoratorId || "none"}`;
    if (!strips.has(key)) {
      strips.set(key, {
        key, jobId: job.id, jobNumber: job.job_number, jobTitle: job.title,
        clientName: job.clients?.name || "—", jobRoute, phase: job.phase,
        priority: job.priority, shipDate: job.target_ship_date,
        decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, items: [],
      });
    }
    strips.get(key)!.items.push({
      ...state, itemId: item.id, jobId: item.job_id, name: item.name, mockupColor: item.mockup_color,
      decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, garmentType: item.garment_type,
    });
  }
  // sort: soonest ship date first, then job number
  return Array.from(strips.values()).sort((a, b) =>
    (a.shipDate || "9999").localeCompare(b.shipDate || "9999") || a.jobNumber.localeCompare(b.jobNumber));
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
