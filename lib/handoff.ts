// The production→warehouse handoff layer (migration 117).
//
// One write path for the handoff spine:
//   shipments / shipment_lines — created when production marks items shipped
//     (shipItemFromDecorator), received by the warehouse. group_key mirrors
//     lib/use-shipments shipmentGroupKey EXACTLY so the legacy derived grouping
//     and these rows can never disagree during the dual-write transition.
//   pull_requests — production asks the warehouse to hold units back
//     (pre-declared on /production or the job page) OR the warehouse logs one
//     ad-hoc at receive/forward time. Fulfilling a pull keeps writing the
//     legacy items.sample_qtys map so ALL existing balance math
//     (deductSamples → forward qty = received − pulled) stays correct.
//   pulled_inventory — where pulled units live after the pull: held →
//     returned (back to stock, restores the forwardable balance) /
//     shipped_out / consumed.
//
// Every function here is dual-write tolerant: a failure writes a console
// error but never blocks the legacy path — the legacy columns remain the
// operational source of truth until readers cut over.

import { shipmentGroupKey, normalizeTracking, isRealTracking } from "./use-shipments";

type Sb = any; // Supabase client (browser or service) — same convention as po-actions

export type ShipmentSeed = {
  job_id: string;
  item_id: string;
  item_name?: string | null;
  decorator_id: string | null;
  decorator_name?: string | null;
  pickup_ready?: boolean;
  ship_tracking?: string | null;
  ship_date?: string | null;      // ISO; defaults to now (ship just happened)
  ship_qtys?: Record<string, number> | null;
  carrier?: string | null;
  expected_arrival?: string | null;
  warehouse_notes?: string | null; // production's instructions to distro
  packing_slip_file_id?: string | null;
};

// Find-or-create the shipment row for this item's box and upsert its line.
// Called once per item from shipItemFromDecorator; batch ships hit the same
// group_key and land as lines on one shipment. warehouse_notes: last writer
// wins ONLY when non-empty (a later item in the batch without notes must not
// blank an earlier note).
export async function upsertShipmentForItem(supabase: Sb, seed: ShipmentSeed): Promise<string | null> {
  try {
    const shipDate = seed.ship_date || new Date().toISOString();
    let groupKey = shipmentGroupKey({
      decorator_id: seed.decorator_id,
      decorator_name: seed.decorator_name,
      pickup_ready: seed.pickup_ready,
      ship_tracking: seed.ship_tracking,
      ship_date: shipDate,
      job_id: seed.job_id,
    });
    const trk = normalizeTracking(seed.ship_tracking);
    let shipmentId: string | null = null;
    let existing = (await supabase
      .from("shipments").select("id, warehouse_notes, status")
      .eq("group_key", groupKey).maybeSingle()).data;
    // A second WAVE of the same item to the same box identity must become its
    // OWN box — otherwise its line overwrites the earlier wave's (one line per
    // item per box) and that wave's units vanish. Detect an existing line for
    // this item and fork to a unique box keyed by this wave's timestamp.
    if (existing) {
      const { data: dupLine } = await supabase
        .from("shipment_lines").select("id")
        .eq("shipment_id", existing.id).eq("item_id", seed.item_id).maybeSingle();
      if (dupLine) { groupKey = `${groupKey}::wave:${shipDate}`; existing = null; }
    }
    if (existing) {
      shipmentId = existing.id;
      const patch: any = {};
      if (seed.warehouse_notes && seed.warehouse_notes.trim()) patch.warehouse_notes = seed.warehouse_notes.trim();
      if (seed.expected_arrival) patch.expected_arrival = seed.expected_arrival;
      if (seed.packing_slip_file_id) patch.packing_slip_file_id = seed.packing_slip_file_id;
      // Re-shipping into a previously received box (undo → re-ship) reopens it.
      if (existing.status !== "expected") patch.status = "expected";
      if (Object.keys(patch).length > 0) {
        await supabase.from("shipments").update(patch).eq("id", existing.id);
      }
    } else {
      const { data: { user } = { user: null } } = await supabase.auth.getUser();
      const { data: created, error } = await supabase.from("shipments").insert({
        direction: "inbound",
        source: "decorator",
        decorator_id: seed.decorator_id,
        group_key: groupKey,
        carrier: seed.carrier || null,
        tracking: isRealTracking(trk) ? trk : null,
        pickup: !!seed.pickup_ready,
        expected_arrival: seed.expected_arrival || null,
        warehouse_notes: (seed.warehouse_notes || "").trim() || null,
        packing_slip_file_id: seed.packing_slip_file_id || null,
        created_by: user?.id || null,
      }).select("id").single();
      if (error) {
        // Unique-violation race (two batch items creating the same box
        // concurrently): re-read and use the winner.
        const { data: retry } = await supabase
          .from("shipments").select("id").eq("group_key", groupKey).maybeSingle();
        shipmentId = retry?.id || null;
        if (!shipmentId) { console.error("[handoff] shipment insert failed", error); return null; }
      } else {
        shipmentId = created.id;
      }
    }
    if (!shipmentId) return null;
    const line = {
      shipment_id: shipmentId,
      item_id: seed.item_id,
      job_id: seed.job_id,
      description: seed.item_name || null,
      ship_qtys: seed.ship_qtys && Object.keys(seed.ship_qtys).length > 0 ? seed.ship_qtys : null,
    };
    const { error: lineErr } = await supabase.from("shipment_lines")
      .upsert(line, { onConflict: "shipment_id,item_id" });
    if (lineErr) console.error("[handoff] shipment_line upsert failed", lineErr);
    return shipmentId;
  } catch (e) {
    console.error("[handoff] upsertShipmentForItem", e);
    return null;
  }
}

// A shipment with zero lines is a meaningless hollow box — delete it,
// REGARDLESS of status. (The old status="expected" filter here leaked hollow
// received boxes, and the v2 return paths deleted lines without any cleanup
// at all — the July-15 hollow-box incident. Every line-delete path must call
// this.) Returns true if the box was empty and removed.
export async function deleteShipmentIfEmpty(supabase: Sb, shipmentId: string): Promise<boolean> {
  const { count } = await supabase
    .from("shipment_lines").select("id", { count: "exact", head: true })
    .eq("shipment_id", shipmentId);
  if ((count ?? 0) > 0) return false;
  const { error } = await supabase.from("shipments").delete().eq("id", shipmentId);
  if (error) { console.error("[handoff] deleteShipmentIfEmpty", error); return false; }
  return true;
}

// Undo paths (undo-shipped, return-to-production): drop the item's line from
// any un-received shipment; delete the shipment if that was its last line.
export async function removeShipmentLineForItem(supabase: Sb, itemId: string): Promise<void> {
  try {
    const { data: lines } = await supabase
      .from("shipment_lines").select("id, shipment_id, received")
      .eq("item_id", itemId).eq("received", false);
    for (const ln of lines || []) {
      await supabase.from("shipment_lines").delete().eq("id", ln.id);
      await deleteShipmentIfEmpty(supabase, ln.shipment_id);
    }
  } catch (e) {
    console.error("[handoff] removeShipmentLineForItem", e);
  }
}

// Receive-side dual write: stamp the item's line(s) received with actual
// qtys/condition/notes, then flip the shipment to received when every line is.
export async function receiveShipmentLineForItem(supabase: Sb, itemId: string, opts: {
  received_qtys?: Record<string, number> | null;
  condition?: string | null;
  notes?: string | null;
}): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { data: lines } = await supabase
      .from("shipment_lines").select("id, shipment_id")
      .eq("item_id", itemId).eq("received", false);
    if (!lines || lines.length === 0) return; // legacy item shipped before 117 — no line exists
    await supabase.from("shipment_lines").update({
      received: true,
      received_at: now,
      received_qtys: opts.received_qtys && Object.keys(opts.received_qtys).length > 0 ? opts.received_qtys : null,
      condition: opts.condition || null,
      notes: (opts.notes || "").trim() || null,
    }).in("id", lines.map((l: any) => l.id));
    const shipmentIds = Array.from(new Set(lines.map((l: any) => l.shipment_id)));
    for (const sid of shipmentIds) {
      const { count } = await supabase
        .from("shipment_lines").select("id", { count: "exact", head: true })
        .eq("shipment_id", sid).eq("received", false);
      if ((count ?? 0) === 0) {
        const { data: { user } = { user: null } } = await supabase.auth.getUser();
        await supabase.from("shipments").update({
          status: "received", received_at: now, received_by: user?.id || null,
        }).eq("id", sid);
      }
    }
  } catch (e) {
    console.error("[handoff] receiveShipmentLineForItem", e);
  }
}

// Mirror of receive-undo: reopen the item's lines + shipment.
export async function unreceiveShipmentLineForItem(supabase: Sb, itemId: string): Promise<void> {
  try {
    const { data: lines } = await supabase
      .from("shipment_lines").select("id, shipment_id")
      .eq("item_id", itemId).eq("received", true);
    if (!lines || lines.length === 0) return;
    await supabase.from("shipment_lines").update({
      received: false, received_at: null, received_qtys: null,
    }).in("id", lines.map((l: any) => l.id));
    const shipmentIds = Array.from(new Set(lines.map((l: any) => l.shipment_id)));
    await supabase.from("shipments").update({ status: "expected", received_at: null, received_by: null })
      .in("id", shipmentIds);
  } catch (e) {
    console.error("[handoff] unreceiveShipmentLineForItem", e);
  }
}

// ── Pull requests ───────────────────────────────────────────────────────

export type PullRequestRow = {
  id: string;
  job_id: string;
  item_id: string;
  kind: string;
  qtys: Record<string, number>;
  fulfilled_qtys: Record<string, number> | null;
  reason: string | null;
  status: "pending" | "partial" | "fulfilled" | "cancelled";
  requested_by_name: string | null;
  created_at: string;
  fulfilled_at: string | null;
};

export const PULL_KINDS = [
  { id: "damaged", label: "Damaged" },
  { id: "sample", label: "Sample" },
  { id: "photo", label: "Photo shoot" },
  { id: "catalog", label: "Catalog" },
  { id: "client", label: "Client" },
  { id: "event", label: "Event" },
  { id: "other", label: "Other" },
] as const;

// Production (or anyone) declares a pull ahead of arrival.
export async function createPullRequest(supabase: Sb, req: {
  job_id: string;
  item_id: string;
  kind?: string;
  qtys: Record<string, number>;
  reason?: string | null;
}): Promise<PullRequestRow | null> {
  const clean = Object.fromEntries(
    Object.entries(req.qtys || {}).map(([s, n]) => [s, Number(n) || 0]).filter(([, n]) => (n as number) > 0)
  );
  if (Object.keys(clean).length === 0) return null;
  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from("pull_requests").insert({
    job_id: req.job_id,
    item_id: req.item_id,
    kind: req.kind || "sample",
    qtys: clean,
    reason: (req.reason || "").trim() || null,
    status: "pending",
    requested_by: user?.id || null,
    requested_by_name: user?.email || null,
  }).select("*").single();
  if (error) { console.error("[handoff] createPullRequest", error); return null; }
  return data as PullRequestRow;
}

export async function updatePullRequest(supabase: Sb, id: string, patch: {
  kind?: string; qtys?: Record<string, number>; reason?: string | null; status?: string;
}): Promise<void> {
  const { error } = await supabase.from("pull_requests").update(patch).eq("id", id);
  if (error) console.error("[handoff] updatePullRequest", error);
}

// Warehouse fulfills a pull (fully or with adjusted qtys). Creates the
// pulled_inventory bucket AND rolls the fulfilled qtys into the legacy
// items.sample_qtys map so the existing balance math (deductSamples) keeps
// deducting pulled units from the forward/continue qty. Caller passes the
// item's CURRENT sample_qtys and gets back the next map to keep local state
// + the item row in sync (the item write happens here, atomically with the
// pull bookkeeping).
export async function fulfillPullRequest(supabase: Sb, pull: PullRequestRow, opts: {
  fulfilledQtys?: Record<string, number>;   // default = requested qtys
  itemName?: string | null;
  currentSampleQtys: Record<string, number>;
  location?: string | null;
}): Promise<Record<string, number>> {
  const qtys = Object.fromEntries(
    Object.entries(opts.fulfilledQtys || pull.qtys || {})
      .map(([s, n]) => [s, Number(n) || 0]).filter(([, n]) => (n as number) > 0)
  ) as Record<string, number>;
  const nextSamples = { ...(opts.currentSampleQtys || {}) };
  for (const [sz, n] of Object.entries(qtys)) nextSamples[sz] = Math.max(0, (nextSamples[sz] || 0) + n);
  const now = new Date().toISOString();
  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  await supabase.from("items").update({ sample_qtys: nextSamples }).eq("id", pull.item_id);
  await supabase.from("pull_requests").update({
    status: "fulfilled", fulfilled_qtys: qtys, fulfilled_at: now, fulfilled_by: user?.id || null,
  }).eq("id", pull.id);
  const { error } = await supabase.from("pulled_inventory").insert({
    pull_request_id: pull.id,
    job_id: pull.job_id,
    item_id: pull.item_id,
    item_name: opts.itemName || null,
    qtys,
    location: (opts.location || "").trim() || null,
    status: "held",
    notes: [pull.kind !== "sample" ? pull.kind : null, pull.reason].filter(Boolean).join(" — ") || null,
  });
  if (error) console.error("[handoff] pulled_inventory insert", error);
  return nextSamples;
}

// One-step ad-hoc pull at receive/forward time: creates an already-fulfilled
// request + its inventory bucket, and returns the next sample_qtys map.
export async function recordAdHocPull(supabase: Sb, req: {
  job_id: string;
  item_id: string;
  item_name?: string | null;
  kind?: string;
  qtys: Record<string, number>;
  reason?: string | null;
  currentSampleQtys: Record<string, number>;
}): Promise<Record<string, number> | null> {
  const created = await createPullRequest(supabase, req);
  // null = the pull_request insert failed (e.g. an invalid kind vs the CHECK
  // constraint). Signal it so the caller does NOT append an orphaned ledger pull
  // movement with no held bucket behind it (which drops forwardable qty but never
  // surfaces in the Pulls tab).
  if (!created) return null;
  return fulfillPullRequest(supabase, created, {
    itemName: req.item_name, currentSampleQtys: req.currentSampleQtys,
  });
}

// Post-Shopify pull (Jon's rule, 2026-07-08): once goods are keyed into
// Shopify, Shopify owns the count — a pull is executed EITHER as a real
// Shopify order (order decrements stock, fulfillment flow ships it) OR as a
// shelf pull where the warehouse manually adjusts the Shopify count. Neither
// touches items.sample_qtys (that math only applies pre-entry). OpsHub just
// closes the request with a trail; a shelf pull also gets a held bucket.
export async function resolvePostShopifyPull(supabase: Sb, pull: PullRequestRow, mode: "shopify_order" | "shelf_pull", opts?: {
  itemName?: string | null;
}): Promise<void> {
  const now = new Date().toISOString();
  const { data: { user } = { user: null } } = await supabase.auth.getUser();
  const note = mode === "shopify_order" ? "Handled as Shopify order" : "Shelf pull — Shopify count adjusted manually";
  await supabase.from("pull_requests").update({
    status: "fulfilled", fulfilled_qtys: pull.qtys, fulfilled_at: now, fulfilled_by: user?.id || null,
    reason: [pull.reason, note].filter(Boolean).join(" · "),
  }).eq("id", pull.id);
  if (mode === "shelf_pull") {
    const { error } = await supabase.from("pulled_inventory").insert({
      pull_request_id: pull.id, job_id: pull.job_id, item_id: pull.item_id,
      item_name: opts?.itemName || null, qtys: pull.qtys, status: "held",
      notes: [pull.kind !== "sample" ? pull.kind : null, pull.reason, "(post-Shopify shelf pull)"].filter(Boolean).join(" — "),
    });
    if (error) console.error("[handoff] post-shopify pulled_inventory insert", error);
  }
}

// Resolve a pulled-inventory bucket. Returning to stock ALSO deducts the
// units back out of items.sample_qtys, which restores the forwardable /
// continuing balance automatically (the whole point of tracking pulls).
export async function resolvePulledInventory(supabase: Sb, row: {
  id: string; item_id: string | null; qtys: Record<string, number>;
}, status: "returned" | "shipped_out" | "consumed", opts?: { notes?: string | null }): Promise<void> {
  const now = new Date().toISOString();
  const patch: any = { status, resolved_at: now, updated_at: now };
  if (opts?.notes !== undefined) patch.notes = (opts.notes || "").trim() || null;
  await supabase.from("pulled_inventory").update(patch).eq("id", row.id);
  if (status === "returned" && row.item_id) {
    const { data: item } = await supabase.from("items").select("sample_qtys").eq("id", row.item_id).maybeSingle();
    if (item) {
      const next = { ...(item.sample_qtys || {}) };
      for (const [sz, n] of Object.entries(row.qtys || {})) {
        next[sz] = Math.max(0, (next[sz] || 0) - (Number(n) || 0));
        if (next[sz] === 0) delete next[sz];
      }
      await supabase.from("items").update({ sample_qtys: next }).eq("id", row.item_id);
    }
  }
}
