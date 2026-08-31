// Server read layer — loads the movement ledger and returns the DERIVED state
// (lib/item-derivation) for an item, a whole job, or a shipment's contents.
// This is the ONE place surfaces read order-state from. No writes here.
//
// Route resolution: item.shipping_route wins, else the job's shipping_route,
// else ship_through (the safe default — comes to HPD).

import { deriveItem, type ItemState, type Movement, type Route, type SizeQtys } from "./item-derivation";
import { computePhase, paymentGateMet, type PhaseItem, type PhaseGate, type PhaseResult } from "./phase-model";
import { poSentToItem } from "./item-status";
import { transitDaysFor } from "./date-chain";
import { addDays } from "./dates";
import { proofSatisfied } from "./proof-gate";

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
  letter: string;              // the PO's letter — full-job sorted position
  decoratorId: string | null;
  decoratorName: string | null;
  decoratorCode: string | null;
  garmentType: string | null;
  embellishments: number;      // (active print locations + tag) × units; garments only
  mockupFileId: string | null; // Drive file id of the latest mockup/proof, for the thumbnail
  shipWaves: { tracking: string | null; total: number }[]; // waves already shipped (for partial rows)
  pullRequests: PullReq[];     // production-declared pulls (held back for sample/photo/etc), pending
  daysInStage: number | null;  // days since the item entered its current pipeline stage (stall signal)
  expectedArrival: string | null; // LEGACY per-ITEM arrival override (items.expected_arrival)
  shipEst: string | null;         // per-ITEM ship/exit-factory date (items.ship_est) — the
                                  // production board's "Adjust date" edit point (R3); tops the ship leg
};
export type PullReq = { id: string; kind: string | null; qtys: Record<string, number>; reason: string | null };
const pullTotal = (p: PullReq) => Object.values(p.qtys || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// Days since the item entered its current pipeline stage (mirrors /production's
// "Xd in stage" stall signal). Falls back to null when we have no timestamp.
function daysInStageFrom(timestamps: any, stage: string | null): number | null {
  const iso = stage && timestamps ? timestamps[stage] : null;
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

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
  jobRoute: Route; phase: string; priority: string | null;
  // The date-chain ship-by for THIS job×vendor strip (locked 2026-07-15):
  // shipDate = live (mid-flight slip, type_meta.po_ship_live[vendor]) else the
  // PO's agreed po_ship_dates[vendor] (may be "ASAP") else null = TBD.
  // shipDateAgreed = the PO plan, kept for the slip badge. poShipKey = the
  // exact vendor key in those type_meta maps (what the in-line edit writes to).
  shipDate: string | null;
  shipDateAgreed: string | null;
  poShipKey: string | null;
  decoratorId: string | null; decoratorName: string; decoratorCode: string | null;
  items: BoardItem[];
};

// The board is gated by ITEM-level truth, not the job's summary phase (locked
// principle from the phase-model session; bug 2026-07-16: an early-released
// item on a mixed job — Eagle Patch, 1 of 5 items PO'd — vanished because the
// stored legacy jobs.phase said "pending"). Prefilter = any PO sent
// (type_meta.po_sent_vendors non-empty); terminal/held jobs stay excluded.
// The per-item filters below (PO-sent-to-vendor, ledger not-closed) do the
// real work.
export async function loadProductionBoard(sb: Sb): Promise<BoardStrip[]> {
  const { data: allJobs } = await sb
    .from("jobs")
    .select("id, job_number, title, phase, priority, target_ship_date, shipping_route, type_meta, costing_data, clients(name)")
    .not("phase", "in", '("complete","cancelled","on_hold")');
  const jobs = (allJobs || []).filter((j: any) => ((j.type_meta?.po_sent_vendors || []) as string[]).length > 0);
  const jobById = new Map<string, any>((jobs || []).map((j: any) => [j.id, j]));
  if (!jobById.size) return [];

  const { data: items } = await sb
    .from("items")
    .select("id, job_id, name, mockup_color, garment_type, shipping_route, ship_final, sort_order, pipeline_stage, pipeline_timestamps, expected_arrival, ship_est, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id, decorators(name, short_code))")
    .in("job_id", Array.from(jobById.keys()));
  if (!items?.length) return [];
  // PO order. Without this the strip's rows (and their A/B/C letters in the
  // Board) ride Postgres's arbitrary return order and can disagree with the
  // PO's lettering (HPD-2608-023, Aug 31 — DB was fine, display wasn't).
  items.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
  // The item's LETTER is the PO's letter: position in the FULL job's sorted
  // list (the PO letters over all items even when it shows one vendor's
  // subset). A strip is job×vendor, so an index within the strip would
  // restart at A per vendor and lie on multi-vendor jobs.
  const letterByItem = new Map<string, string>();
  { const perJob = new Map<string, number>();
    for (const it of items as any[]) { const n = perJob.get(it.job_id) || 0; letterByItem.set(it.id, String.fromCharCode(65 + n)); perJob.set(it.job_id, n + 1); } }

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

  // pending production-declared pulls per item
  const { data: pulls } = await sb
    .from("pull_requests").select("id, item_id, kind, qtys, reason, status").in("item_id", ids).in("status", ["pending", "partial"]);
  const pullsByItem = new Map<string, PullReq[]>();
  for (const p of pulls || []) {
    const a = pullsByItem.get(p.item_id) || []; a.push({ id: p.id, kind: p.kind, qtys: p.qtys || {}, reason: p.reason }); pullsByItem.set(p.item_id, a);
  }

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
      // chain ship-by for this job×vendor: live slip > agreed PO date > TBD.
      // Vendor keys in type_meta maps come from the PO tab (printVendor label);
      // match case-insensitively against every alias we know for the vendor.
      const tm = job.type_meta || {};
      const findVendorKey = (map: Record<string, any> | null | undefined): string | null => {
        if (!map) return null;
        for (const k of Object.keys(map)) if (vendorKeys.includes(k.toLowerCase().trim())) return k;
        return null;
      };
      const agreedKey = findVendorKey(tm.po_ship_dates);
      const liveKey = findVendorKey(tm.po_ship_live);
      const agreed: string | null = agreedKey ? tm.po_ship_dates[agreedKey] || null : null;
      const live: string | null = liveKey ? tm.po_ship_live[liveKey]?.date || null : null;
      strips.set(key, {
        key, jobId: job.id, jobNumber: job.job_number, jobTitle: job.title,
        clientName: job.clients?.name || "—", invoiceNumber: job.type_meta?.qb_invoice_number || null,
        jobRoute, phase: job.phase,
        priority: job.priority,
        shipDate: (live && live !== "ASAP") ? live : agreed,
        shipDateAgreed: agreed,
        poShipKey: agreedKey || cp?.printVendor || assign.decorators?.name || null,
        decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, items: [],
      });
    }
    strips.get(key)!.items.push({
      ...state, itemId: item.id, jobId: item.job_id, name: item.name, letter: letterByItem.get(item.id) || "", mockupColor: item.mockup_color,
      decoratorId, decoratorName, decoratorCode: assign.decorators?.short_code || null, garmentType: item.garment_type,
      embellishments: embellishmentsFor(item.garment_type, job.costing_data?.costProds || [], state.orderedTotal),
      mockupFileId: mockupById.get(item.id) || null,
      shipWaves: shipWavesFrom(rawByItem.get(item.id) || []),
      pullRequests: pullsByItem.get(item.id) || [],
      daysInStage: daysInStageFrom(item.pipeline_timestamps, item.pipeline_stage),
      expectedArrival: item.expected_arrival || null,
      shipEst: item.ship_est || null,
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

// ── recent shipped boxes (the Production "Shipped" view) ───────────────────
// Boxes shipped from production, not yet received — so you can still notify the
// warehouse/client after the ship modal is gone (a closed item leaves the board).
export type ShippedBoxLine = {
  client: string; invoiceNumber: string | null; itemName: string; qty: number; qtys: SizeQtys; mockupFileId: string | null;
  // cumulative shipped across ALL boxes exceeds the order — almost always a
  // duplicate ship entry (Tank Lock: 288 shipped vs 144 ordered sat invisible
  // 4 days). 0 = fine.
  overShippedTotal: number;
};
export type ShippedBox = {
  id: string; vendorName: string; carrier: string | null; tracking: string | null; pickup: boolean;
  createdAt: string; route: Route; totalUnits: number; clients: string[]; lines: ShippedBoxLine[]; hasSlip: boolean;
  notifiedAt: string | null; notifiedTo: string | null;   // warehouse notify, persisted (mig 143)
  jobId: string | null;                                    // first line's job — drop-ship deep link
};
const sumQ = (q: SizeQtys) => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

export async function loadRecentShipments(sb: Sb): Promise<ShippedBox[]> {
  const cutoff = new Date(Date.now() - 21 * 86400000).toISOString();
  const { data: ships } = await sb.from("shipments")
    .select("id, tracking, carrier, pickup, status, created_at, packing_slip_file_id, warehouse_notified_at, warehouse_notified_to, decorators(name)")
    .eq("direction", "inbound").gte("created_at", cutoff).order("created_at", { ascending: false }).limit(80);
  const active = (ships || []).filter((s: any) => s.status !== "received");
  if (!active.length) return [];
  const ids = active.map((s: any) => s.id);
  const { data: lines } = await sb.from("shipment_lines")
    .select("shipment_id, item_id, job_id, description, ship_qtys, items(name, shipping_route, ship_qtys, buy_sheet_lines(qty_ordered), jobs(shipping_route, type_meta, clients(name)))").in("shipment_id", ids);
  const itemIds = Array.from(new Set((lines || []).map((l: any) => l.item_id).filter(Boolean)));
  const { data: slips } = itemIds.length
    ? await sb.from("item_files").select("item_id").eq("stage", "packing_slip").not("drive_link", "is", null).in("item_id", itemIds)
    : { data: [] as any[] };
  const slipItems = new Set((slips || []).map((s: any) => s.item_id));
  const { data: mockups } = itemIds.length
    ? await sb.from("item_files").select("item_id, drive_file_id, stage, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", itemIds).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const mockById = new Map<string, string>();
  for (const f of mockups || []) { if (f.stage === "mockup" && f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  for (const f of mockups || []) { if (f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  const byShip = new Map<string, any[]>();
  for (const l of lines || []) { const a = byShip.get(l.shipment_id) || []; a.push(l); byShip.set(l.shipment_id, a); }

  const boxes: ShippedBox[] = [];
  for (const s of active) {
    const ls = byShip.get(s.id) || [];
    if (!ls.length) continue;
    const boxLines: ShippedBoxLine[] = ls.map((l: any) => {
      const ordered = (l.items?.buy_sheet_lines || []).reduce((a: number, b: any) => a + (Number(b.qty_ordered) || 0), 0);
      return {
        client: l.items?.jobs?.clients?.name || "—",
        invoiceNumber: l.items?.jobs?.type_meta?.qb_invoice_number || null,
        itemName: l.items?.name || l.description || "Item",
        qty: sumQ(l.ship_qtys), qtys: l.ship_qtys || {}, mockupFileId: mockById.get(l.item_id) || null,
        overShippedTotal: ordered > 0 ? Math.max(0, sumQ(l.items?.ship_qtys || {}) - ordered) : 0,
      };
    });
    boxes.push({
      id: s.id, vendorName: (s as any).decorators?.name || "Unassigned vendor",
      carrier: s.carrier, tracking: s.tracking, pickup: !!s.pickup, createdAt: s.created_at,
      route: resolveRoute(ls[0]?.items?.shipping_route, ls[0]?.items?.jobs?.shipping_route),
      totalUnits: boxLines.reduce((a, l) => a + l.qty, 0),
      clients: Array.from(new Set(boxLines.map(l => l.client))), lines: boxLines,
      hasSlip: !!s.packing_slip_file_id || ls.some((l: any) => slipItems.has(l.item_id)),
      notifiedAt: (s as any).warehouse_notified_at || null,
      notifiedTo: (s as any).warehouse_notified_to || null,
      jobId: ls[0]?.job_id || null,
    });
  }
  return boxes;
}

// ── the Receiving board (box-centric — the /receiving2 surface) ────────────
// Every inbound box not yet fully received, with its lines: per-item, per-variant
// shipped (the box manifest) + what's already received. A box spans any number of
// jobs/clients; the receive modal counts each line in and routes it downstream.
export type ReceivingLine = {
  itemId: string; jobId: string; itemName: string; mockupFileId: string | null;
  client: string; invoiceNumber: string | null; route: Route;
  shipQtys: SizeQtys;         // what this box says was shipped
  receivedQtys: SizeQtys;     // already counted in for this line
  cumReceived: SizeQtys;      // item's running received across ALL boxes (for the ledger target)
  orderedTotal: number;       // full order qty for the item (to flag a partial wave)
  shipFinal: boolean;         // item closed at ship (final flag OR fully shipped) → a
                              // gap vs ordered is a SHORTAGE, not "more coming"
  overShippedTotal: number;   // cumulative shipped across ALL boxes − ordered (>0 =
                              // likely duplicate ship entry; the Tank Lock signal)
  received: boolean;
  pullRequests: PullReq[];    // production-declared pulls pending on this item (fulfil at receiving)
};
export type ReceivingBox = {
  id: string; vendorName: string; carrier: string | null; tracking: string | null; pickup: boolean;
  createdAt: string; receivedAt: string | null;
  // expectedArrival: resolved box ETA. etaSource says who set it — "carrier"
  // (live tracker estimate; the only PLAIN date, everything else renders ~),
  // "human" (expected_arrival / item overrides), "derived" (ship day +
  // vendor transit), null (TBD).
  expectedArrival: string | null; etaSource: "carrier" | "human" | "derived" | null;
  // live carrier feed (EasyPost) — signals, never receiving truth
  carrierStatus: string | null; deliveredAt: string | null;
  lastScan: { status?: string | null; description?: string | null; location?: string | null; at?: string | null } | null;
  trackingError: string | null; deliveredNotFoundAt: string | null;
  status: string;
  note: string | null;  // warehouse note typed at ship time
  slips: { name: string; url: string }[];
  lines: ReceivingLine[]; totalUnits: number; receivedUnits: number; clients: string[]; allReceived: boolean;
};

// Returns BOTH incoming and received recent boxes — the UI splits on allReceived
// (box.allReceived) for the Incoming / Received status toggle.
export async function loadReceivingBoard(sb: Sb): Promise<ReceivingBox[]> {
  // Un-received boxes load regardless of age — a box must never silently fall
  // off Incoming just because it sat 45+ days (slow freight, stalled receiving).
  // The date window only prunes RECEIVED boxes, to keep the Received tab bounded.
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  const { data: ships } = await sb.from("shipments")
    .select("id, tracking, carrier, pickup, status, expected_arrival, expected_arrival_edited_at, est_delivery_date, est_delivery_updated_at, delivered_at, carrier_status, last_scan, tracking_error, delivered_not_found_at, created_at, received_at, warehouse_notes, decorators(name, transit_defaults)")
    .eq("direction", "inbound").or(`status.neq.received,created_at.gte.${cutoff}`)
    .order("created_at", { ascending: false }).limit(160);
  const open = ships || [];
  if (!open.length) return [];
  const ids = open.map((s: any) => s.id);
  const { data: lines } = await sb.from("shipment_lines")
    .select("shipment_id, item_id, job_id, description, ship_qtys, received_qtys, received, items(name, mockup_color, shipping_route, ship_final, received_qtys, ship_qtys, expected_arrival, buy_sheet_lines(qty_ordered), jobs(shipping_route, type_meta, clients(name)))").in("shipment_id", ids);
  const itemIds = Array.from(new Set((lines || []).map((l: any) => l.item_id).filter(Boolean)));

  // pending production-declared pulls per item, to fulfil at receiving
  const { data: pulls } = itemIds.length
    ? await sb.from("pull_requests").select("id, item_id, kind, qtys, reason, status").in("item_id", itemIds).in("status", ["pending", "partial"])
    : { data: [] as any[] };
  const pullsByItem = new Map<string, PullReq[]>();
  for (const p of pulls || []) { const a = pullsByItem.get(p.item_id) || []; a.push({ id: p.id, kind: p.kind, qtys: p.qtys || {}, reason: p.reason }); pullsByItem.set(p.item_id, a); }

  const { data: slipFiles } = itemIds.length
    ? await sb.from("item_files").select("item_id, file_name, drive_link").eq("stage", "packing_slip").not("drive_link", "is", null).in("item_id", itemIds)
    : { data: [] as any[] };
  const { data: mockups } = itemIds.length
    ? await sb.from("item_files").select("item_id, drive_file_id, stage, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", itemIds).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const mockById = new Map<string, string>();
  for (const f of mockups || []) { if (f.stage === "mockup" && f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  for (const f of mockups || []) { if (f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  const slipsByItem = new Map<string, { name: string; url: string }[]>();
  for (const f of slipFiles || []) { const a = slipsByItem.get(f.item_id) || []; a.push({ name: f.file_name || "Packing slip", url: f.drive_link }); slipsByItem.set(f.item_id, a); }

  const byShip = new Map<string, any[]>();
  for (const l of lines || []) { const a = byShip.get(l.shipment_id) || []; a.push(l); byShip.set(l.shipment_id, a); }

  // "First wave carries it": a production-declared pull belongs to ONE shipment —
  // the EARLIEST un-received box that holds the item (falls back to the earliest
  // box if all are received). So the pull shows on that box's receive modal only,
  // not duplicated across every wave of a multi-wave item.
  const pullBoxByItem = new Map<string, string>();
  for (const itemId of Array.from(pullsByItem.keys())) {
    let unrecv: { id: string; created: string } | null = null;
    let earliest: { id: string; created: string } | null = null;
    for (const s of open) {
      const line = (byShip.get(s.id) || []).find((l: any) => l.item_id === itemId);
      if (!line) continue;
      if (!earliest || s.created_at < earliest.created) earliest = { id: s.id, created: s.created_at };
      if (!line.received && (!unrecv || s.created_at < unrecv.created)) unrecv = { id: s.id, created: s.created_at };
    }
    const pick = unrecv || earliest;
    if (pick) pullBoxByItem.set(itemId, pick.id);
  }

  const boxes: ReceivingBox[] = [];
  for (const s of open) {
    const ls = byShip.get(s.id) || [];
    if (!ls.length) continue;
    const rLines: ReceivingLine[] = ls.map((l: any) => {
      const orderedTotal = (l.items?.buy_sheet_lines || []).reduce((a: number, b: any) => a + (Number(b.qty_ordered) || 0), 0);
      return {
        itemId: l.item_id, jobId: l.job_id, itemName: l.items?.name || l.description || "Item", mockupFileId: mockById.get(l.item_id) || null,
        client: l.items?.jobs?.clients?.name || "—", invoiceNumber: l.items?.jobs?.type_meta?.qb_invoice_number || null,
        route: resolveRoute(l.items?.shipping_route, l.items?.jobs?.shipping_route),
        shipQtys: l.ship_qtys || {}, receivedQtys: l.received_qtys || {}, cumReceived: l.items?.received_qtys || {},
        orderedTotal,
        shipFinal: !!l.items?.ship_final,
        overShippedTotal: orderedTotal > 0 ? Math.max(0, sumQ(l.items?.ship_qtys || {}) - orderedTotal) : 0,
        received: !!l.received, pullRequests: pullBoxByItem.get(l.item_id) === s.id ? (pullsByItem.get(l.item_id) || []) : [],
      };
    })
      // drop_ship goes vendor→client and never touches HPD — it must not appear in
      // Receiving (the ship still shows in production2's Shipped view). A box with
      // ONLY drop_ship lines drops out entirely.
      .filter((l) => l.route !== "drop_ship");
    if (!rLines.length) continue;
    const slipMap = new Map<string, { name: string; url: string }>();
    for (const l of ls) for (const sl of slipsByItem.get(l.item_id) || []) slipMap.set(sl.url, sl);
    // Box ETA (Rule B, locked 2026-07-16: FRESHEST SIGNAL WINS):
    //   1. human expected_arrival vs carrier est_delivery — newer timestamp
    //      wins (a legacy human edit with no timestamp loses to live carrier
    //      data, which is the point of Rule B);
    //   2. else per-ITEM arrival overrides (latest governs — box lands with
    //      its slowest item);
    //   3. else ship day + vendor transit default;
    //   4. else TBD. Never a guess beyond the chain (R5).
    const { eta: boxEta, source: etaSource } = (() => {
      type Src = "carrier" | "human" | "derived" | null;
      const human = s.expected_arrival ? { d: String(s.expected_arrival), at: s.expected_arrival_edited_at || "0" } : null;
      const carrierEta = s.est_delivery_date ? { d: String(s.est_delivery_date), at: s.est_delivery_updated_at || "0" } : null;
      if (human && carrierEta) return human.at >= carrierEta.at
        ? { eta: human.d, source: "human" as Src } : { eta: carrierEta.d, source: "carrier" as Src };
      if (human) return { eta: human.d, source: "human" as Src };
      if (carrierEta) return { eta: carrierEta.d, source: "carrier" as Src };
      const lineOverrides = ls.map((l: any) => l.items?.expected_arrival).filter(Boolean) as string[];
      if (lineOverrides.length) return { eta: lineOverrides.sort()[lineOverrides.length - 1], source: "human" as Src };
      const td = (s as any).decorators?.transit_defaults;
      const transit = transitDaysFor(td, s.pickup ? "Pick Up" : s.carrier);
      const proj = transit != null ? addDays(String(s.created_at).slice(0, 10), transit) : null;
      return { eta: proj, source: (proj ? "derived" : null) as Src };
    })();
    boxes.push({
      id: s.id, vendorName: (s as any).decorators?.name || "Unassigned vendor",
      carrier: s.carrier, tracking: s.tracking, pickup: !!s.pickup, createdAt: s.created_at, receivedAt: s.received_at || null,
      expectedArrival: boxEta, etaSource,
      carrierStatus: s.carrier_status || null, deliveredAt: s.delivered_at || null,
      lastScan: s.last_scan || null, trackingError: s.tracking_error || null,
      deliveredNotFoundAt: s.delivered_not_found_at || null,
      status: s.status || "expected", note: s.warehouse_notes || null,
      slips: Array.from(slipMap.values()),
      lines: rLines, totalUnits: rLines.reduce((a, l) => a + sumQ(l.shipQtys), 0),
      receivedUnits: rLines.reduce((a, l) => a + sumQ(l.receivedQtys), 0),
      clients: Array.from(new Set(rLines.map(l => l.client))),
      allReceived: s.status === "received" || (rLines.length > 0 && rLines.every(l => l.received)),
    });
  }
  return boxes;
}

// ── the phase model loader — feeds the pure engine (lib/phase-model) real data ──
// Marries the gates (quote / payment-per-terms / proofs / po_sent) with each item's
// ledger-derived stage, then computes the three views. Parallel to the old
// calculatePhase; the surfaces swap to this at cutover.
export type JobPhaseView = { phase: string; detail?: string; clientLabel: string; fulfillment: { out: number; total: number }; result: PhaseResult };

const JOB_PHASE_SELECT = "id, quote_approved, payment_terms, shipping_route, phase, type_meta, costing_data";
const JOB_PHASE_ITEM_SELECT = "id, job_id, name, shipping_route, ship_final, artwork_status, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorators(name, short_code))";

// Pure assembler — given ONE job's rows (already loaded), compute its phase view.
// Shared by loadJobPhase (single) and loadJobPhasesBatch (bulk) so the logic lives once.
function buildJobPhaseView(
  job: any, items: any[], payments: any[],
  movesByItem: Map<string, Movement[]>, proofByItem: Map<string, { any: boolean; allApproved: boolean }>,
): JobPhaseView {
  if (job.phase === "on_hold" || job.phase === "cancelled") {
    return { phase: job.phase, clientLabel: "none", fulfillment: { out: 0, total: 0 }, result: { job: { key: "intake", label: job.phase }, fulfillment: { out: 0, total: 0 }, client: "none", itemStages: [] } };
  }
  if (!items.length) {
    return { phase: "Intake", clientLabel: "none", fulfillment: { out: 0, total: 0 }, result: { job: { key: "intake", label: "Intake" }, fulfillment: { out: 0, total: 0 }, client: "none", itemStages: [] } };
  }
  const poSentVendors = ((job.type_meta?.po_sent_vendors || []) as string[]);
  const costProds = (job.costing_data?.costProds || []) as any[];
  const phaseItems: PhaseItem[] = items.map(it => {
    const route = resolveRoute(it.shipping_route, job.shipping_route);
    const st = deriveItem({ ordered: orderedFrom(it.buy_sheet_lines || []), route, shipFinal: !!it.ship_final, movements: movesByItem.get(it.id) || [] });
    const cp = costProds.find(c => c?.id === it.id) || costProds.find(c => c?.name === it.name);
    const da = (it.decorator_assignments || [])[0];
    const poSent = poSentToItem({ printVendor: cp?.printVendor, decoratorName: da?.decorators?.name, decoratorShortCode: da?.decorators?.short_code, poSentVendors });
    return { route, poSent, shippedTotal: st.shippedTotal, receivedTotal: st.receivedTotal, forwardedTotal: st.forwardedTotal, enteredTotal: st.enteredTotal, done: st.done };
  });
  const gate: PhaseGate = {
    quoteApproved: !!job.quote_approved,
    paymentReceived: paymentGateMet(job.payment_terms, (payments || []) as any),
    proofsApproved: items.every(it => { const pr = proofByItem.get(it.id); return proofSatisfied(it, pr?.any ? pr : undefined); }),
  };
  const noticeSent = Array.isArray(job.type_meta?.shipping_notifications) && job.type_meta.shipping_notifications.length > 0;
  const result = computePhase({ gate, items: phaseItems, noticeSent });
  return { phase: result.job.label, detail: result.job.detail, clientLabel: result.client, fulfillment: result.fulfillment, result };
}

export async function loadJobPhase(sb: Sb, jobId: string): Promise<JobPhaseView | null> {
  const { data: job } = await sb.from("jobs").select(JOB_PHASE_SELECT).eq("id", jobId).single();
  if (!job) return null;
  const { data: items } = await sb.from("items").select(JOB_PHASE_ITEM_SELECT).eq("job_id", jobId);
  const ids = ((items || []) as any[]).map(i => i.id);
  const { data: payments } = await sb.from("payment_records").select("amount, status").eq("job_id", jobId);
  const { data: moves } = ids.length ? await sb.from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", ids) : { data: [] };
  const byItem = new Map<string, Movement[]>();
  for (const m of moves || []) { const a = byItem.get(m.item_id) || []; a.push(toMovement(m)); byItem.set(m.item_id, a); }
  const { data: proofs } = ids.length ? await sb.from("item_files").select("item_id, approval").eq("stage", "proof").is("superseded_at", null).in("item_id", ids) : { data: [] };
  const proofByItem = new Map<string, { any: boolean; allApproved: boolean }>();
  for (const p of proofs || []) { const cur = proofByItem.get(p.item_id) || { any: false, allApproved: true }; cur.any = true; if (p.approval !== "approved") cur.allApproved = false; proofByItem.set(p.item_id, cur); }
  return buildJobPhaseView(job, (items || []) as any[], (payments || []) as any[], byItem, proofByItem);
}

// Bulk phase views for a list of jobs — 5 queries total instead of 5×N. Used by
// the jobs list, dashboard, and portal so the additive phase model scales.
export async function loadJobPhasesBatch(sb: Sb, jobIds: string[]): Promise<Map<string, JobPhaseView>> {
  const out = new Map<string, JobPhaseView>();
  if (!jobIds.length) return out;
  const { data: jobs } = await sb.from("jobs").select(JOB_PHASE_SELECT).in("id", jobIds);
  const { data: items } = await sb.from("items").select(JOB_PHASE_ITEM_SELECT).in("job_id", jobIds);
  const itemIds = ((items || []) as any[]).map(i => i.id);
  const { data: payments } = await sb.from("payment_records").select("job_id, amount, status").in("job_id", jobIds);
  const { data: moves } = itemIds.length ? await sb.from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", itemIds) : { data: [] };
  const { data: proofs } = itemIds.length ? await sb.from("item_files").select("item_id, approval").eq("stage", "proof").is("superseded_at", null).in("item_id", itemIds) : { data: [] };

  const itemsByJob = new Map<string, any[]>();
  for (const it of (items || []) as any[]) { const a = itemsByJob.get(it.job_id) || []; a.push(it); itemsByJob.set(it.job_id, a); }
  const paysByJob = new Map<string, any[]>();
  for (const p of (payments || []) as any[]) { const a = paysByJob.get(p.job_id) || []; a.push(p); paysByJob.set(p.job_id, a); }
  const movesByItem = new Map<string, Movement[]>();
  for (const m of moves || []) { const a = movesByItem.get(m.item_id) || []; a.push(toMovement(m)); movesByItem.set(m.item_id, a); }
  const proofByItem = new Map<string, { any: boolean; allApproved: boolean }>();
  for (const p of proofs || []) { const cur = proofByItem.get(p.item_id) || { any: false, allApproved: true }; cur.any = true; if (p.approval !== "approved") cur.allApproved = false; proofByItem.set(p.item_id, cur); }

  for (const job of (jobs || []) as any[]) {
    out.set(job.id, buildJobPhaseView(job, itemsByJob.get(job.id) || [], paysByJob.get(job.id) || [], movesByItem, proofByItem));
  }
  return out;
}

// ── the Shipping board (ship_through — forward received goods to the client) ──
// Ship_through jobs with items in the shipping window (shipped, not yet fully
// forwarded). Per item: available-to-forward (received − pulled − forwarded) vs
// still-owed (more coming from production). Job is "ready" when everything's in.
export type ShippingItem = {
  itemId: string; jobId: string; name: string; mockupFileId: string | null;
  availableTotal: number; available: SizeQtys;   // ready to forward now
  owedTotal: number;                              // still to ship from production
  comingTotal: number;                            // genuinely still coming = in-transit (unreceived box) + owed
  shortTotal: number;                             // received short + all boxes in = a real shortage (NOT coming)
  pulledTotal: number; forwardedTotal: number; receivedTotal: number;
  readyDownstream: boolean; done: boolean; status: string;
};
export type ShippingJob = {
  jobId: string; jobNumber: string; jobTitle: string; clientName: string;
  invoiceNumber: string | null; shipTo: string | null;
  items: ShippingItem[];
  status: "ready" | "awaiting";
  readyUnits: number; comingUnits: number;
};

export async function loadShippingBoard(sb: Sb): Promise<ShippingJob[]> {
  const { data: jobs } = await sb.from("jobs")
    .select("id, job_number, title, phase, shipping_route, type_meta, clients(name, shipping_address)")
    .in("phase", ["receiving", "shipping", "fulfillment"]);
  if (!jobs?.length) return [];
  const jobById = new Map<string, any>((jobs as any[]).map(j => [j.id, j]));

  const { data: items } = await sb.from("items")
    .select("id, job_id, name, mockup_color, shipping_route, ship_final, buy_sheet_lines(size, qty_ordered)")
    .in("job_id", Array.from(jobById.keys()));
  if (!items?.length) return [];
  // PO order. Without this the strip's rows (and their A/B/C letters in the
  // Board) ride Postgres's arbitrary return order and can disagree with the
  // PO's lettering (HPD-2608-023, Aug 31 — DB was fine, display wasn't).
  items.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
  // The item's LETTER is the PO's letter: position in the FULL job's sorted
  // list (the PO letters over all items even when it shows one vendor's
  // subset). A strip is job×vendor, so an index within the strip would
  // restart at A per vendor and lie on multi-vendor jobs.
  const letterByItem = new Map<string, string>();
  { const perJob = new Map<string, number>();
    for (const it of items as any[]) { const n = perJob.get(it.job_id) || 0; letterByItem.set(it.id, String.fromCharCode(65 + n)); perJob.set(it.job_id, n + 1); } }
  const ids = (items as any[]).map(i => i.id);

  const { data: allMoves } = await sb.from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", ids);
  const byItem = new Map<string, Movement[]>();
  for (const m of allMoves || []) { const a = byItem.get(m.item_id) || []; a.push(toMovement(m)); byItem.set(m.item_id, a); }

  // receiveFinal per item = it has inbound shipment lines and ALL are counted in.
  // (A short then is a real shortage, not still-in-transit.)
  const { data: slines } = await sb.from("shipment_lines").select("item_id, received, shipments(direction)").in("item_id", ids);
  const recvByItem = new Map<string, { inbound: number; received: number }>();
  for (const l of slines || []) {
    if ((l as any).shipments?.direction !== "inbound") continue;
    const cur = recvByItem.get(l.item_id) || { inbound: 0, received: 0 };
    cur.inbound += 1; if (l.received) cur.received += 1;
    recvByItem.set(l.item_id, cur);
  }

  const { data: mockupFiles } = await sb.from("item_files")
    .select("item_id, drive_file_id, stage, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", ids)
    .order("created_at", { ascending: false });
  const mockById = new Map<string, string>();
  for (const f of mockupFiles || []) { if (f.stage === "mockup" && f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  for (const f of mockupFiles || []) { if (f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }

  const byJob = new Map<string, ShippingItem[]>();
  for (const item of items as any[]) {
    const job = jobById.get(item.job_id); if (!job) continue;
    const route = resolveRoute(item.shipping_route, job.shipping_route);
    if (route !== "ship_through") continue;
    const rc = recvByItem.get(item.id);
    const receiveFinal = !!rc && rc.inbound > 0 && rc.received === rc.inbound;
    const st = deriveItem({ ordered: orderedFrom(item.buy_sheet_lines || []), route, shipFinal: !!item.ship_final, receiveFinal, movements: byItem.get(item.id) || [] });
    // In the shipping window = something has shipped and it's not fully forwarded.
    if (st.shippedTotal === 0 && st.owedTotal === 0) continue;
    if (st.done) continue;
    // shipped − received: still in-transit if a box is unreceived; a real shortage if all boxes are in.
    const gap = Math.max(0, st.shippedTotal - st.receivedTotal);
    const a = byJob.get(item.job_id) || [];
    a.push({
      itemId: item.id, jobId: item.job_id, name: item.name, mockupFileId: mockById.get(item.id) || null,
      availableTotal: st.availableToForwardTotal, available: st.availableToForward,
      owedTotal: st.owedTotal, comingTotal: st.owedTotal + (receiveFinal ? 0 : gap), shortTotal: receiveFinal ? gap : 0,
      pulledTotal: st.pulledTotal, forwardedTotal: st.forwardedTotal, receivedTotal: st.receivedTotal,
      readyDownstream: st.readyDownstream, done: st.done, status: st.status,
    });
    byJob.set(item.job_id, a);
  }

  const out: ShippingJob[] = [];
  for (const [jobId, its] of Array.from(byJob.entries())) {
    if (!its.length) continue;
    const job = jobById.get(jobId);
    // awaiting = any item still coming (not ready and not done); else ready.
    const awaiting = its.some(it => !it.readyDownstream && !it.done);
    out.push({
      jobId, jobNumber: job.job_number, jobTitle: job.title,
      clientName: job.clients?.name || "—", invoiceNumber: job.type_meta?.qb_invoice_number || null,
      shipTo: job.clients?.shipping_address || null,
      items: its,
      status: awaiting ? "awaiting" : "ready",
      readyUnits: its.reduce((s, it) => s + it.availableTotal, 0),
      comingUnits: its.reduce((s, it) => s + it.comingTotal, 0),
    });
  }
  return out.sort((a, b) => (a.status === b.status ? 0 : a.status === "ready" ? -1 : 1) || a.jobNumber.localeCompare(b.jobNumber));
}

// ── forwarded outbound shipments (the Shipping "Forwarded" view) ───────────
export type ForwardedLine = { itemId: string; jobId: string; itemName: string; mockupFileId: string | null; client: string; invoiceNumber: string | null; route: Route; qtys: SizeQtys };
export type ForwardedShipment = {
  id: string; carrier: string | null; tracking: string | null; createdAt: string;
  clients: string[]; jobNumbers: string[]; totalUnits: number; lines: ForwardedLine[];
};
export async function loadForwardedShipments(sb: Sb): Promise<ForwardedShipment[]> {
  const cutoff = new Date(Date.now() - 45 * 86400000).toISOString();
  const { data: ships } = await sb.from("shipments")
    .select("id, carrier, tracking, created_at").eq("direction", "outbound").gte("created_at", cutoff)
    .order("created_at", { ascending: false }).limit(160);
  if (!ships?.length) return [];
  const ids = (ships as any[]).map(s => s.id);
  const { data: lines } = await sb.from("shipment_lines")
    .select("shipment_id, item_id, job_id, description, ship_qtys, items(name, mockup_color, shipping_route, jobs(job_number, shipping_route, type_meta, clients(name)))").in("shipment_id", ids);
  const itemIds = Array.from(new Set((lines || []).map((l: any) => l.item_id).filter(Boolean)));
  const { data: mockups } = itemIds.length
    ? await sb.from("item_files").select("item_id, drive_file_id, stage, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", itemIds).order("created_at", { ascending: false })
    : { data: [] as any[] };
  const mockById = new Map<string, string>();
  for (const f of mockups || []) { if (f.stage === "mockup" && f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  for (const f of mockups || []) { if (f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  const byShip = new Map<string, any[]>();
  for (const l of lines || []) { const a = byShip.get(l.shipment_id) || []; a.push(l); byShip.set(l.shipment_id, a); }

  const out: ForwardedShipment[] = [];
  for (const s of ships as any[]) {
    const ls = byShip.get(s.id) || [];
    if (!ls.length) continue;
    const fLines: ForwardedLine[] = ls.map((l: any) => ({
      itemId: l.item_id, jobId: l.job_id, itemName: l.items?.name || l.description || "Item", mockupFileId: mockById.get(l.item_id) || null,
      client: l.items?.jobs?.clients?.name || "—", invoiceNumber: l.items?.jobs?.type_meta?.qb_invoice_number || null,
      route: resolveRoute(l.items?.shipping_route, l.items?.jobs?.shipping_route), qtys: l.ship_qtys || {},
    }));
    out.push({
      id: s.id, carrier: s.carrier, tracking: s.tracking, createdAt: s.created_at,
      clients: Array.from(new Set(fLines.map(l => l.client))),
      jobNumbers: Array.from(new Set(ls.map((l: any) => l.items?.jobs?.job_number).filter(Boolean))),
      totalUnits: fLines.reduce((a, l) => a + sumQ(l.qtys), 0), lines: fLines,
    });
  }
  return out;
}

// ── the Staging board (stage route — stage received goods for Shopify entry) ──
// The distro "Staging" surface (mirrored with front-office "E-Comm"). stage-route
// items land here the moment they're received; the action is "Enter into Shopify"
// which is the END of OpsHub's road. Two views: ready-to-enter vs entered.
export type StagingItem = {
  itemId: string; jobId: string; jobNumber: string; name: string; mockupFileId: string | null;
  client: string; invoiceNumber: string | null;
  blankVendor: string | null; blankSku: string | null; color: string | null;  // blank info
  available: SizeQtys; availableTotal: number;   // ready to enter = received − pulled − entered
  entered: SizeQtys; enteredTotal: number;
  status: string;
};

export async function loadStagingBoard(sb: Sb): Promise<StagingItem[]> {
  // COMPLETE stage jobs stay on the board: entering the last units flips the
  // job complete, and dropping it here made freshly-entered items vanish from
  // the Entered tab (KYS tee / Overpass, Jul 28). The availableToEnter/entered
  // guard below keeps anything without staged history off the board.
  const { data: jobs } = await sb.from("jobs")
    .select("id, job_number, phase, shipping_route, type_meta, costing_data, clients(name)")
    .or("phase.in.(receiving,shipping,fulfillment),and(phase.eq.complete,shipping_route.eq.stage)");
  if (!jobs?.length) return [];
  const jobById = new Map<string, any>((jobs as any[]).map(j => [j.id, j]));

  const { data: items } = await sb.from("items")
    .select("id, job_id, name, mockup_color, shipping_route, ship_final, blank_vendor, blank_sku, buy_sheet_lines(size, qty_ordered)")
    .in("job_id", Array.from(jobById.keys()));
  if (!items?.length) return [];
  // PO order. Without this the strip's rows (and their A/B/C letters in the
  // Board) ride Postgres's arbitrary return order and can disagree with the
  // PO's lettering (HPD-2608-023, Aug 31 — DB was fine, display wasn't).
  items.sort((a: any, b: any) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name || "").localeCompare(String(b.name || "")));
  // The item's LETTER is the PO's letter: position in the FULL job's sorted
  // list (the PO letters over all items even when it shows one vendor's
  // subset). A strip is job×vendor, so an index within the strip would
  // restart at A per vendor and lie on multi-vendor jobs.
  const letterByItem = new Map<string, string>();
  { const perJob = new Map<string, number>();
    for (const it of items as any[]) { const n = perJob.get(it.job_id) || 0; letterByItem.set(it.id, String.fromCharCode(65 + n)); perJob.set(it.job_id, n + 1); } }
  const ids = (items as any[]).map(i => i.id);

  const { data: allMoves } = await sb.from("movements").select("id, item_id, type, qtys, shipment_id, reverses_id").in("item_id", ids);
  const byItem = new Map<string, Movement[]>();
  for (const m of allMoves || []) { const a = byItem.get(m.item_id) || []; a.push(toMovement(m)); byItem.set(m.item_id, a); }

  const { data: mockupFiles } = await sb.from("item_files")
    .select("item_id, drive_file_id, stage, created_at").in("stage", ["mockup", "proof"]).is("superseded_at", null).in("item_id", ids)
    .order("created_at", { ascending: false });
  const mockById = new Map<string, string>();
  for (const f of mockupFiles || []) { if (f.stage === "mockup" && f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }
  for (const f of mockupFiles || []) { if (f.drive_file_id && !mockById.has(f.item_id)) mockById.set(f.item_id, f.drive_file_id); }

  const out: StagingItem[] = [];
  for (const item of items as any[]) {
    const job = jobById.get(item.job_id); if (!job) continue;
    const route = resolveRoute(item.shipping_route, job.shipping_route);
    if (route !== "stage") continue;
    const st = deriveItem({ ordered: orderedFrom(item.buy_sheet_lines || []), route, shipFinal: !!item.ship_final, movements: byItem.get(item.id) || [] });
    if (st.availableToEnterTotal === 0 && st.enteredTotal === 0) continue;   // not yet in the staging window
    // color: costing cp.color (by id/name), else mockup_color
    const cps = (job.costing_data?.costProds || []) as any[];
    const cp = cps.find(c => c?.id === item.id) || cps.find(c => c?.name === item.name);
    let color = (cp?.color || item.mockup_color || "").trim() || null;
    if (color && color.startsWith("#")) color = null;   // a raw hex mockup color isn't a real blank color name
    out.push({
      itemId: item.id, jobId: item.job_id, jobNumber: job.job_number, name: item.name, mockupFileId: mockById.get(item.id) || null,
      client: job.clients?.name || "—", invoiceNumber: job.type_meta?.qb_invoice_number || null,
      blankVendor: (item.blank_vendor || "").trim() || null, blankSku: (item.blank_sku || "").trim() || null, color,
      available: st.availableToEnter, availableTotal: st.availableToEnterTotal,
      entered: st.entered, enteredTotal: st.enteredTotal, status: st.status,
    });
  }
  return out.sort((a, b) => a.client.localeCompare(b.client) || a.name.localeCompare(b.name));
}

// ── held pulls (the Pulls tab — where pulled units land, with their action) ─
export type HeldPull = {
  id: string; itemId: string; jobId: string; itemName: string;
  client: string; invoiceNumber: string | null;
  qtys: SizeQtys; action: string; location: string | null; createdAt: string;
};
export async function loadPulls(sb: Sb): Promise<HeldPull[]> {
  const { data } = await sb.from("pulled_inventory")
    .select("id, item_id, job_id, item_name, qtys, location, notes, created_at, items(name, jobs(type_meta, clients(name)))")
    .eq("status", "held").order("created_at", { ascending: false }).limit(300);
  return (data || []).map((r: any) => ({
    id: r.id, itemId: r.item_id, jobId: r.job_id, itemName: r.items?.name || r.item_name || "Item",
    client: r.items?.jobs?.clients?.name || "—", invoiceNumber: r.items?.jobs?.type_meta?.qb_invoice_number || null,
    qtys: r.qtys || {}, action: r.notes || "", location: r.location || null, createdAt: r.created_at,
  }));
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
