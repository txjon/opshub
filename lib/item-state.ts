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
  embellishments: number;      // (active print locations + tag) × units; garments only
  mockupFileId: string | null; // Drive file id of the latest mockup/proof, for the thumbnail
  shipWaves: { tracking: string | null; total: number }[]; // waves already shipped (for partial rows)
};

// Ship waves already sent for an item = each non-reversed ship movement.
function shipWavesFrom(raw: any[]): { tracking: string | null; total: number }[] {
  const reversed = new Set((raw || []).filter(m => m.reverses_id).map(m => m.reverses_id));
  return (raw || [])
    .filter(m => m.type === "ship" && !reversed.has(m.id))
    .map(m => ({ tracking: (m.tracking || null), total: Object.values(m.qtys || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0) }))
    .filter(w => w.total > 0);
}

// Non-garment items aren't screen-printed/embroidered — excluded from the
// Embellishments count (still counted in Items + Units). Mirrors /production.
const NON_GARMENT = new Set(["accessory", "patch", "sticker", "poster", "pin", "koozie", "banner", "flag", "lighter", "towel", "water_bottle", "samples", "custom", "key_chain", "woven_labels", "bandana", "socks", "tote", "custom_bag", "pillow", "rug", "pens", "napkins", "balloons", "stencils"]);

// Embellishments for one item = (active print locations + tag print) × units,
// read from the item's costing entry (matched by garment type). Same math as the
// /production "Prints" KPI, which Jon confirmed is correct.
function embellishmentsFor(garmentType: string | null, costProds: any[], units: number): number {
  if (!garmentType || NON_GARMENT.has(garmentType)) return 0;
  const cp = (costProds || []).find((c: any) => c?.garment_type === garmentType);
  if (!cp) return 0;
  const activeLocs = [1, 2, 3, 4, 5, 6].filter(loc => {
    const ld = cp.printLocations?.[loc];
    return ld?.screens > 0 || ld?.location;
  }).length;
  const hasTag = cp.tagPrint ? 1 : 0;
  return (activeLocs + hasTag) * units;
}
export type BoardStrip = {
  key: string;                 // jobId::decoratorId
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  invoiceNumber: string | null; // QB invoice # (client-facing id, from type_meta)
  jobRoute: Route; phase: string; priority: string | null; shipDate: string | null;
  decoratorId: string | null; decoratorName: string; decoratorCode: string | null;
  items: BoardItem[];
};

// Only jobs actually past the ordering gate. NOT "ready" (POs not sent yet) and
// NOT "on_hold" — those items haven't been pushed to a decorator.
const ACTIVE_PHASES = ["production", "receiving", "shipping", "fulfillment"];

export async function loadProductionBoard(sb: Sb): Promise<BoardStrip[]> {
  const { data: jobs } = await sb
    .from("jobs")
    .select("id, job_number, title, phase, priority, target_ship_date, shipping_route, type_meta, costing_data, clients(name)")
    .in("phase", ACTIVE_PHASES);
  const jobById = new Map<string, any>((jobs || []).map((j: any) => [j.id, j]));
  if (!jobById.size) return [];

  const { data: items } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, garment_type, shipping_route, ship_final, sort_order, pipeline_stage, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id, decorators(name, short_code))")
    .in("job_id", Array.from(jobById.keys()));
  if (!items?.length) return [];

  // batch movements
  const ids = items.map((i: any) => i.id);
  const { data: allMoves } = await sb
    .from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id, tracking").in("item_id", ids);
  const byItem = new Map<string, Movement[]>();
  const rawByItem = new Map<string, any[]>();
  for (const m of allMoves || []) {
    const a = byItem.get(m.item_id) || []; a.push(toMovement(m)); byItem.set(m.item_id, a);
    const r = rawByItem.get(m.item_id) || []; r.push(m); rawByItem.set(m.item_id, r);
  }

  // latest mockup/proof per item, for the row thumbnail. Prefer a real mockup
  // (an image) over a proof (often a PDF, which has no thumbnail).
  const { data: mockupFiles } = await sb
    .from("item_files").select("item_id, drive_file_id, stage, created_at")
    .in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", ids)
    .order("created_at", { ascending: false });
  const mockupById = new Map<string, string>();
  for (const f of mockupFiles || []) { if (f.stage === "mockup" && f.drive_file_id && !mockupById.has(f.item_id)) mockupById.set(f.item_id, f.drive_file_id); }
  for (const f of mockupFiles || []) { if (f.drive_file_id && !mockupById.has(f.item_id)) mockupById.set(f.item_id, f.drive_file_id); }

  const strips = new Map<string, BoardStrip>();
  for (const item of items) {
    const job = jobById.get(item.job_id); if (!job) continue;
    const assign = (item.decorator_assignments || [])[0] || {};

    // Membership = the item has actually been pushed to its decorator. Mirrors
    // the live /production board: pipeline_stage says in_production/shipped, OR a
    // PO was sent to its vendor (po_sent_vendors — the PO email doesn't reliably
    // write pipeline_stage). Vendor keys match decorator name/short_code + the
    // costing printVendor label.
    const poSent = new Set<string>(((job.type_meta?.po_sent_vendors || []) as string[]).map((s: string) => (s || "").toLowerCase().trim()));
    const cp = (job.costing_data?.costProds || []).find((c: any) => c?.id === item.id);
    const vendorKeys = [assign.decorators?.name, assign.decorators?.short_code, cp?.printVendor]
      .filter(Boolean).map((s: string) => s.toLowerCase().trim());
    const poSentToVendor = vendorKeys.some(v => poSent.has(v));
    if (item.pipeline_stage !== "in_production" && item.pipeline_stage !== "shipped" && !poSentToVendor) continue;

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
    const decoratorId = assign.decorator_id || null;
    const decoratorName = assign.decorators?.name || "Unassigned vendor";
    const key = `${item.job_id}::${decoratorId || "none"}`;
    if (!strips.has(key)) {
      strips.set(key, {
        key, jobId: job.id, jobNumber: job.job_number, jobTitle: job.title,
        clientName: job.clients?.name || "—", invoiceNumber: job.type_meta?.qb_invoice_number || null,
        jobRoute, phase: job.phase,
        priority: job.priority, shipDate: job.target_ship_date,
        decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, items: [],
      });
    }
    strips.get(key)!.items.push({
      ...state, itemId: item.id, jobId: item.job_id, name: item.name, mockupColor: item.mockup_color,
      decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, garmentType: item.garment_type,
      embellishments: embellishmentsFor(item.garment_type, job.costing_data?.costProds || [], state.orderedTotal),
      mockupFileId: mockupById.get(item.id) || null,
      shipWaves: shipWavesFrom(rawByItem.get(item.id) || []),
    });
  }
  // sort: soonest ship date first, then job number
  return Array.from(strips.values()).sort((a, b) =>
    (a.shipDate || "9999").localeCompare(b.shipDate || "9999") || a.jobNumber.localeCompare(b.jobNumber));
}

// Freight carriers we've used before (the BOL "learning list" — a datalist that
// grows as new freight carriers get typed and saved on shipments). Excludes the
// standard parcel carriers, which have their own fixed dropdown.
const PARCEL_CARRIERS = new Set(["ups", "dhl", "fedex", "usps"]);
export async function loadFreightCarriers(sb: Sb): Promise<string[]> {
  const { data } = await sb.from("shipments").select("carrier").not("carrier", "is", null).limit(2000);
  const seen = new Set<string>();
  for (const r of data || []) {
    const c = (r.carrier || "").trim();
    if (c && c.toLowerCase() !== "freight" && !PARCEL_CARRIERS.has(c.toLowerCase())) seen.add(c);
  }
  return Array.from(seen).sort();
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
