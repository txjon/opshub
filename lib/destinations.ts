// Destinations — THE one place that answers "where is this going?"
// (split shipments foundation, mig 180, Sep 15 2026).
//
// Objects:
//   client_locations   the client's address book ("Main", "Marketing office",
//                      ...). job_id set = a one-off address for that project.
//   jobs.ship_to_location_id   the project's default destination.
//   item_destinations  per-item per-size split across locations. No rows on an
//                      item = 100% to the project default.
//   shipments.location_id / ship_to_snapshot   every client-bound box knows
//                      where it went; the address is frozen at ship time.
//
// Every surface that prints or decides a ship-to (PO/RFQ PDF, vendor portal,
// shipping board, forward, packing slip, hub, notify) imports from here.
// Nothing re-derives an address on its own — that is how the pre-180 code
// ended up with a Shipping board that showed a different address than the
// project page.
//
// Design map: https://claude.ai/artifact/TaR32tPynQBHzpn7BFk2hv

import type { Movement } from "./item-derivation";

type Sb = any;
export type SizeQtys = Record<string, number>;

export type LocationRow = {
  id: string;
  client_id: string;
  job_id: string | null;
  label: string;
  address: string;
  contact_name?: string | null;
  contact_phone?: string | null;
  is_default: boolean;
  active: boolean;
};

export type ShipTo = {
  locationId: string | null;   // null only on the legacy fallback (pre-backfill rows)
  label: string;
  address: string;
  contactName: string | null;
  contactPhone: string | null;
};

export type ItemDestination = { shipTo: ShipTo; qtys: SizeQtys; sortOrder: number };

export const sumQ = (q: SizeQtys | null | undefined) =>
  Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const toShipTo = (l: LocationRow): ShipTo => ({
  locationId: l.id, label: l.label, address: l.address,
  contactName: l.contact_name ?? null, contactPhone: l.contact_phone ?? null,
});

// ── Pure resolvers ─────────────────────────────────────────────────────

// The project's default destination.
//   1. jobs.ship_to_location_id (set by the backfill for every existing job,
//      by Logistics for new ones)
//   2. the client's default book entry
//   3. LEGACY: type_meta.venue_address / clients.shipping_address — only for a
//      job created between mig 180 and the Logistics cutover. Deleted in the
//      cleanup phase together with those fields.
export function resolveJobShipTo(
  job: { ship_to_location_id?: string | null; type_meta?: any; clients?: { shipping_address?: string | null } | null },
  locations: LocationRow[],
): ShipTo | null {
  const byId = new Map(locations.map(l => [l.id, l]));
  const chosen = job.ship_to_location_id ? byId.get(job.ship_to_location_id) : undefined;
  if (chosen) return toShipTo(chosen);
  const def = locations.find(l => l.is_default && !l.job_id && l.active);
  if (def) return toShipTo(def);
  const legacy = String(job.type_meta?.venue_address || job.clients?.shipping_address || "").trim();
  if (legacy) return { locationId: null, label: "Main", address: legacy, contactName: null, contactPhone: null };
  return null;
}

// Where an item's units go. No split rows → everything to the project default.
// With split rows → one entry per destination in fill order (R7: when a vendor
// ships short, the first destination fills first).
export function itemDestinations(args: {
  ordered: SizeQtys;
  jobShipTo: ShipTo | null;
  splits: { location_id: string; qtys: SizeQtys; sort_order: number }[];
  locations: LocationRow[];
}): ItemDestination[] {
  const byId = new Map(args.locations.map(l => [l.id, l]));
  const rows = args.splits
    .map(s => ({ loc: byId.get(s.location_id), qtys: s.qtys || {}, sortOrder: s.sort_order }))
    .filter(r => !!r.loc)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  if (rows.length) return rows.map(r => ({ shipTo: toShipTo(r.loc!), qtys: r.qtys, sortOrder: r.sortOrder }));
  if (!args.jobShipTo) return [];
  return [{ shipTo: args.jobShipTo, qtys: args.ordered, sortOrder: 0 }];
}

export const isSplit = (dests: ItemDestination[]) => dests.length > 1;

// Per-size units already sent to each location: ship movements (drop_ship,
// vendor→client) or forward movements (ship_through, HPD→client), attributed
// through the box they rode in. Boxes with no location (pre-180, or inbound
// vendor→HPD legs) are ignored — they went to HPD, not to a destination.
export function sentByLocation(
  movements: Movement[],
  boxLocation: Map<string, string | null>,   // shipment_id → location_id
  type: "ship" | "forward",
): Map<string, SizeQtys> {
  const out = new Map<string, SizeQtys>();
  for (const m of movements) {
    if (m.type !== type || !m.shipmentId) continue;
    const loc = boxLocation.get(m.shipmentId);
    if (!loc) continue;
    const cur = out.get(loc) || {};
    for (const [size, n] of Object.entries(m.qtys || {})) cur[size] = (cur[size] || 0) + (Number(n) || 0);
    out.set(loc, cur);
  }
  return out;
}

// What a destination is still owed = its share − what already went there,
// never below zero. Per size.
export function owedToLocation(share: SizeQtys, sent: SizeQtys | undefined): SizeQtys {
  const out: SizeQtys = {};
  for (const [size, n] of Object.entries(share || {})) {
    const left = (Number(n) || 0) - (Number(sent?.[size]) || 0);
    if (left > 0) out[size] = left;
  }
  return out;
}

// Mailing-label lines from a free-text address (newline- or comma-separated).
export function addressLines(addr: string | null | undefined): string[] {
  const s = String(addr || "").trim();
  if (!s) return [];
  if (s.includes("\n")) return s.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  return s.split(/,\s*/).map(x => x.trim()).filter(Boolean);
}

// ── Server loaders ─────────────────────────────────────────────────────

// The client's book plus any one-off locations for this project.
export async function loadLocations(sb: Sb, clientId: string | null, jobId?: string | null): Promise<LocationRow[]> {
  if (!clientId) return [];
  let q = sb.from("client_locations")
    .select("id, client_id, job_id, label, address, contact_name, contact_phone, is_default, active")
    .eq("client_id", clientId).eq("active", true);
  q = jobId ? q.or(`job_id.is.null,job_id.eq.${jobId}`) : q.is("job_id", null);
  const { data } = await q.order("is_default", { ascending: false }).order("label");
  return (data || []) as LocationRow[];
}

export async function loadJobShipTo(sb: Sb, jobId: string): Promise<ShipTo | null> {
  const { data: job } = await sb.from("jobs")
    .select("id, client_id, ship_to_location_id, type_meta, clients(shipping_address)").eq("id", jobId).single();
  if (!job) return null;
  const locations = await loadLocations(sb, job.client_id, jobId);
  return resolveJobShipTo(job, locations);
}

// Per-item destinations for a whole job in one round trip.
export async function loadJobDestinations(sb: Sb, jobId: string): Promise<{
  shipTo: ShipTo | null;
  locations: LocationRow[];
  byItem: Map<string, ItemDestination[]>;
}> {
  const { data: job } = await sb.from("jobs")
    .select("id, client_id, ship_to_location_id, type_meta, clients(shipping_address), items(id, buy_sheet_lines(size, qty_ordered))")
    .eq("id", jobId).single();
  if (!job) return { shipTo: null, locations: [], byItem: new Map() };
  const locations = await loadLocations(sb, job.client_id, jobId);
  const shipTo = resolveJobShipTo(job, locations);
  const itemIds = (job.items || []).map((i: any) => i.id);
  const { data: splits } = itemIds.length
    ? await sb.from("item_destinations").select("item_id, location_id, qtys, sort_order").in("item_id", itemIds)
    : { data: [] };
  const splitsByItem = new Map<string, any[]>();
  for (const s of splits || []) { const a = splitsByItem.get(s.item_id) || []; a.push(s); splitsByItem.set(s.item_id, a); }
  const byItem = new Map<string, ItemDestination[]>();
  for (const it of job.items || []) {
    const ordered: SizeQtys = {};
    for (const l of it.buy_sheet_lines || []) if (l.size) ordered[l.size] = (ordered[l.size] || 0) + (Number(l.qty_ordered) || 0);
    byItem.set(it.id, itemDestinations({ ordered, jobShipTo: shipTo, splits: splitsByItem.get(it.id) || [], locations }));
  }
  return { shipTo, locations, byItem };
}
