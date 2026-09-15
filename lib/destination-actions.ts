// Destination WRITES (split shipments, mig 180). Browser-side actions; the
// UI (components/DestinationsPanel, components/ClientLocations) is a thin view
// over these. Reads live in lib/destinations.ts.
//
// TRANSITION RULE (delete with the fields at cleanup): until every reader has
// moved to lib/destinations, the legacy address fields — jobs.type_meta
// .venue_address and clients.shipping_address — are PROJECTED from the new
// truth here, and nowhere else. Invoice PDF, QuickBooks, packing slip, PO PDF
// and the hub still read those fields, so a Logistics edit must reach them
// with zero stale state. One writer; when the readers are migrated the two
// project*() helpers and the fields go together.

import { sumQ, type LocationRow, type SizeQtys } from "./destinations";

type Sb = any;

const LOC_COLS = "id, client_id, job_id, label, address, contact_name, contact_phone, is_default, active";

async function projectLegacyJobAddress(sb: Sb, jobId: string, address: string | null) {
  const { data: job } = await sb.from("jobs").select("type_meta").eq("id", jobId).single();
  const meta = { ...(job?.type_meta || {}) };
  if (address) meta.venue_address = address; else delete meta.venue_address;
  const { error } = await sb.from("jobs").update({ type_meta: meta }).eq("id", jobId);
  if (error) throw new Error(error.message);
  return meta;
}

async function projectLegacyClientAddress(sb: Sb, clientId: string, address: string | null) {
  const { error } = await sb.from("clients").update({ shipping_address: address }).eq("id", clientId);
  if (error) throw new Error(error.message);
}

// Every project whose default is this location gets its legacy mirror refreshed.
async function reprojectJobsUsing(sb: Sb, locationId: string, address: string) {
  const { data: jobs } = await sb.from("jobs").select("id").eq("ship_to_location_id", locationId);
  for (const j of jobs || []) await projectLegacyJobAddress(sb, j.id, address);
}

export async function createLocation(sb: Sb, args: {
  clientId: string; jobId?: string | null; label: string; address: string;
  contactName?: string | null; contactPhone?: string | null; makeDefault?: boolean;
}): Promise<LocationRow> {
  const label = args.label.trim() || (args.jobId ? "Project address" : "Main");
  const address = args.address.trim();
  if (!address) throw new Error("Address is required.");
  let isDefault = false;
  if (!args.jobId) {
    const { count } = await sb.from("client_locations").select("id", { count: "exact", head: true })
      .eq("client_id", args.clientId).is("job_id", null).eq("is_default", true);
    isDefault = !!args.makeDefault || !count;
    if (isDefault && count) await sb.from("client_locations").update({ is_default: false }).eq("client_id", args.clientId).is("job_id", null).eq("is_default", true);
  }
  const { data, error } = await sb.from("client_locations").insert({
    client_id: args.clientId, job_id: args.jobId || null, label, address,
    contact_name: args.contactName?.trim() || null, contact_phone: args.contactPhone?.trim() || null, is_default: isDefault,
  }).select(LOC_COLS).single();
  if (error) throw new Error(error.message);
  if (isDefault) await projectLegacyClientAddress(sb, args.clientId, address);
  return data as LocationRow;
}

export async function updateLocation(sb: Sb, id: string, patch: {
  label?: string; address?: string; contactName?: string | null; contactPhone?: string | null;
}): Promise<LocationRow> {
  const row: any = { updated_at: new Date().toISOString() };
  if (patch.label !== undefined) row.label = patch.label.trim() || "Main";
  if (patch.address !== undefined) { row.address = patch.address.trim(); if (!row.address) throw new Error("Address is required."); }
  if (patch.contactName !== undefined) row.contact_name = patch.contactName?.trim() || null;
  if (patch.contactPhone !== undefined) row.contact_phone = patch.contactPhone?.trim() || null;
  const { data, error } = await sb.from("client_locations").update(row).eq("id", id).select(LOC_COLS).single();
  if (error) throw new Error(error.message);
  const loc = data as LocationRow;
  if (patch.address !== undefined) {
    if (loc.is_default && !loc.job_id) await projectLegacyClientAddress(sb, loc.client_id, loc.address);
    await reprojectJobsUsing(sb, loc.id, loc.address);
  }
  return loc;
}

export async function setDefaultLocation(sb: Sb, clientId: string, id: string): Promise<void> {
  await sb.from("client_locations").update({ is_default: false }).eq("client_id", clientId).is("job_id", null).eq("is_default", true);
  const { data, error } = await sb.from("client_locations").update({ is_default: true }).eq("id", id).select(LOC_COLS).single();
  if (error) throw new Error(error.message);
  await projectLegacyClientAddress(sb, clientId, (data as LocationRow).address);
}

// Retire = hide from pickers. Refused for the default (pick another first) and
// for a location a project still ships to (it would vanish from Logistics).
export async function retireLocation(sb: Sb, id: string): Promise<void> {
  const { data: loc } = await sb.from("client_locations").select(LOC_COLS).eq("id", id).single();
  if (!loc) return;
  if (loc.is_default) throw new Error("This is the default address. Make another one the default first.");
  const { count: jobsUsing } = await sb.from("jobs").select("id", { count: "exact", head: true }).eq("ship_to_location_id", id);
  const { count: splitsUsing } = await sb.from("item_destinations").select("id", { count: "exact", head: true }).eq("location_id", id);
  if (jobsUsing || splitsUsing) throw new Error("A project still ships to this address. Change that project first.");
  const { error } = await sb.from("client_locations").update({ active: false, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

// The project's default destination. Returns the projected type_meta so the
// caller can keep its local job state in step.
export async function setJobShipTo(sb: Sb, jobId: string, loc: LocationRow): Promise<Record<string, any>> {
  const { error } = await sb.from("jobs").update({ ship_to_location_id: loc.id }).eq("id", jobId);
  if (error) throw new Error(error.message);
  return projectLegacyJobAddress(sb, jobId, loc.address);
}

export type SplitRow = { locationId: string; qtys: SizeQtys };

// Replace an item's split. Destination shares must add up to ordered, per size
// (R3) — the UI enforces it, this is the backstop. Rows with no units are
// dropped; a split with one destination left is no split (rows cleared).
export async function saveItemSplit(sb: Sb, itemId: string, ordered: SizeQtys, rows: SplitRow[]): Promise<void> {
  const clean = rows.map(r => ({ ...r, qtys: Object.fromEntries(Object.entries(r.qtys || {}).filter(([, n]) => (Number(n) || 0) > 0).map(([s, n]) => [s, Number(n)])) }))
    .filter(r => sumQ(r.qtys) > 0);
  for (const size of new Set([...Object.keys(ordered), ...clean.flatMap(r => Object.keys(r.qtys))])) {
    const want = Number(ordered[size]) || 0;
    const have = clean.reduce((a, r) => a + (Number(r.qtys[size]) || 0), 0);
    if (want !== have) throw new Error(`Size ${size}: destinations add up to ${have}, ordered is ${want}.`);
  }
  const { error: delErr } = await sb.from("item_destinations").delete().eq("item_id", itemId);
  if (delErr) throw new Error(delErr.message);
  if (clean.length < 2) return;
  const { error } = await sb.from("item_destinations").insert(clean.map((r, i) => ({ item_id: itemId, location_id: r.locationId, qtys: r.qtys, sort_order: i })));
  if (error) throw new Error(error.message);
}

export async function clearItemSplit(sb: Sb, itemId: string): Promise<void> {
  const { error } = await sb.from("item_destinations").delete().eq("item_id", itemId);
  if (error) throw new Error(error.message);
}
