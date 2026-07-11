"use client";
import { useMemo } from "react";
import { tQty, type WarehouseJob, type WarehouseItem } from "@/lib/use-warehouse";

// A Shipment is a derived concept — not stored as its own row. We group
// items by `(decorator, tracking)`. Items sharing both came in (or are
// coming in) as one physical box from one vendor.
//
// Grouping rules:
//   1. Primary key = (decorator_id || decorator_name, normalized tracking).
//      "Normalized" = trimmed + uppercased. Vendors paste trailing spaces
//      and varying case constantly; we'd over-split without this.
//   2. When ship_tracking is empty, fall back to
//      (decorator, "notrk:" + ship_date.slice(0,10) + ":" + job_id).
//      Same-vendor + same-day + same-job no-tracking shipments collapse
//      into one row; rare edge case of two same-day no-tracking boxes
//      from one vendor to one job stays a single row (receiver can
//      manually split by typing a placeholder tracking number).
//   3. Items whose effective shipping_route is "drop_ship" are already
//      filtered out upstream in useWarehouse — they never reach here.
//
// Shipments may span multiple jobs if a vendor consolidates items from
// different projects into one tracking number (rare in practice; only
// happens via manual tracking entry across projects). The shape carries
// a list of project chips so the UI can render that case correctly.

export type Shipment = {
  // Group key, opaque — only used as React key + dedupe.
  key: string;
  decorator_id: string | null;
  decorator_name: string;
  short_code: string;
  // null = vendor didn't supply tracking. UI should show a placeholder
  // ("no tracking") and offer the receiver a paste field.
  tracking: string | null;
  // True when this is a local-pickup block (grouped by vendor, not tracking).
  // UI shows "PICK-UP" instead of "no tracking".
  pickup: boolean;
  // Earliest pipeline_timestamps.shipped across the shipment's items.
  // null when none of the items have a shipped timestamp (received-only
  // historical case — e.g. legacy rows where ship_date isn't populated).
  shipped_at: string | null;
  // Earliest received_at_hpd_at across the shipment's items that ARE
  // received. null if no item is received yet (pure pending shipment).
  // Powers the "received X days ago" line on rows in the Received tab.
  received_at: string | null;
  items: WarehouseItem[];

  // Project context — one entry per distinct job_id in the shipment.
  // Usually a single entry; multi-project shipments render as a list.
  jobs: Array<{
    id: string;
    job_number: string;
    title: string;
    client_name: string;
    shipping_route: string;
    display_number: string;       // QB invoice # if available, else job_number
  }>;

  // Rollups derived from items.
  total_items: number;
  total_units: number;
  pending_count: number;
  received_count: number;
  // sum(received_qtys) − sum(ship_qtys || qtys), across received items only.
  // Negative = short; positive = over-receive; zero = clean.
  variance_units: number;
  all_received: boolean;
};

// A local pickup has no carrier tracking — stamp it with vendor + date so the
// shipment still has a concrete, referenceable identity ("Pickup · OSM · Jul 10")
// instead of a blank. Same vendor + same day = one pickup trip = one box.
export function pickupTrackingStamp(vendorLabel: string | null | undefined, dateIso?: string | null): string {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = dateIso ? new Date(dateIso) : new Date();
  const v = (vendorLabel || "Vendor").trim() || "Vendor";
  // Include the time so two pickup WAVES on the same day get distinct stamps
  // (and land in distinct boxes) instead of colliding.
  const h24 = d.getHours();
  const ampm = h24 >= 12 ? "p" : "a";
  const h = ((h24 + 11) % 12) + 1;
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `Pickup · ${v} · ${MON[d.getMonth()]} ${d.getDate()}, ${h}:${mm}${ampm}`;
}

export function normalizeTracking(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

// Words vendors type into the tracking field when there's no real tracking
// number — freight/LTL (carried under a BOL, not a parcel tracking ID), local
// pickup, hand-delivered. These are shipping *methods*, not tracking IDs. If we
// treat them as tracking, every "<same decorator> + <same word>" item across
// ALL jobs collapses into one shipment — so receiving one job's freight box
// drags in other jobs' items, including already-received ones. Route these to
// the job-scoped no-tracking fallback instead (keeps jobs separate; still
// groups one job's freight items into a single box).
const NON_TRACKING_TOKENS = new Set([
  "freight", "ltl", "pallet", "truck", "truck freight",
  "n/a", "na", "none", "tbd", "no tracking", "notracking",
  "local", "pickup", "pick up", "pick-up", "local pickup", "will call",
  "hand delivery", "handdelivery", "delivered",
]);

export function isRealTracking(trk: string | null | undefined): boolean {
  return !!trk && !NON_TRACKING_TOKENS.has(trk.trim().toLowerCase());
}

// Pure group-key builder, shared with the persisted `shipments` table
// (lib/handoff.ts writes shipments.group_key with THIS function) so the
// derived grouping and the stored rows can never disagree during the
// dual-write transition. Any change here changes the persisted key — keep
// them moving together.
export function shipmentGroupKey(f: {
  decorator_id: string | null;
  decorator_name?: string | null;
  pickup_ready?: boolean;
  ship_tracking?: string | null;
  ship_date?: string | null;
  job_id: string;
}): string {
  const decKey = f.decorator_id || f.decorator_name || "unassigned";
  // Local pickup: one trip = one box. Group a vendor's pickup items by DAY so
  // two pickups from the same vendor on different days are distinct boxes
  // (matching their vendor+date stamps); same vendor + same day collapse into
  // one trip.
  if (f.pickup_ready) {
    const dateDay = f.ship_date ? f.ship_date.slice(0, 10) : "unknown";
    return `${decKey}::pickup:${dateDay}`;
  }
  const trk = normalizeTracking(f.ship_tracking);
  if (isRealTracking(trk)) return `${decKey}::${trk}`;
  // Fallback: bucket by (decorator, ship_date_day, job_id). Including
  // job_id here means a vendor that ships items for two different jobs
  // on the same day with no tracking gets two separate rows — which
  // matches reality (two distinct deliveries).
  const dateDay = f.ship_date ? f.ship_date.slice(0, 10) : "unknown";
  return `${decKey}::notrk:${dateDay}:${f.job_id}`;
}

function groupKeyFor(item: WarehouseItem): string {
  return shipmentGroupKey(item);
}

// The persisted-box source: `boxes` = { shipments, lines } loaded from the
// migration-117 tables. Each shipments row is a REAL box (one tracking / one
// vendor drop); its lines carry that box's per-item qtys + receive state. This
// is why two waves of the same item show as two separate boxes in receiving,
// each received on its own date — instead of collapsing into the item's
// cumulative under one tracking number (the old derive-from-item bug).
//
// Items with NO persisted line (shipped before migration 117) fall back to the
// old derive-from-item grouping so nothing vanishes from receiving.
export function useShipments(
  jobs: WarehouseJob[],
  boxes?: { shipments: any[]; lines: any[] },
): Shipment[] {
  return useMemo(() => {
    type Acc = {
      key: string;
      decorator_id: string | null;
      decorator_name: string;
      short_code: string;
      tracking: string | null;
      pickup?: boolean;
      items: WarehouseItem[];
      jobIds: Set<string>;
      shippedAtCandidates: string[];
      receivedAtOverride?: string | null;
    };
    const groups = new Map<string, Acc>();

    // Index for job + item context lookup.
    const jobIndex = new Map<string, WarehouseJob>();
    for (const j of jobs) jobIndex.set(j.id, j);
    const itemIndex = new Map<string, WarehouseItem>();
    for (const j of jobs) for (const it of j.items) itemIndex.set(it.id, it);

    // ── Real boxes from the persisted shipment_lines ──────────────────────
    const shipmentRows: any[] = boxes?.shipments || [];
    const lineRows: any[] = boxes?.lines || [];
    const shipmentById = new Map<string, any>();
    for (const s of shipmentRows) shipmentById.set(s.id, s);
    const linesByShipment = new Map<string, any[]>();
    for (const l of lineRows) {
      if (!linesByShipment.has(l.shipment_id)) linesByShipment.set(l.shipment_id, []);
      linesByShipment.get(l.shipment_id)!.push(l);
    }
    // Items covered by at least one persisted line — they use real boxes, so
    // they must NOT also be synthesized by the legacy fallback below.
    const coveredItemIds = new Set<string>(lineRows.map(l => l.item_id));

    for (const [shipmentId, lines] of Array.from(linesByShipment.entries())) {
      const box = shipmentById.get(shipmentId);
      const boxItems: WarehouseItem[] = [];
      let anyJobId: string | null = null;
      for (const line of lines) {
        const base = itemIndex.get(line.item_id);
        if (!base) continue; // item not in the loaded/relevant set (e.g. drop_ship, filtered upstream)
        anyJobId = base.job_id;
        // Older lines (shipped before wave-qty capture) can carry empty
        // ship_qtys — fall back to the item's own qty so the box isn't blank.
        // (Multi-box wave lines always carry their own qtys, so no over-count.)
        const lineShip = (line.ship_qtys && Object.keys(line.ship_qtys).length) ? line.ship_qtys : (base.ship_qtys || {});
        const lineRecv = (line.received_qtys && Object.keys(line.received_qtys).length) ? line.received_qtys : (line.received ? lineShip : {});
        boxItems.push({
          ...base,
          // Box-scoped numbers = THIS box's line, not the item's cumulative.
          ship_qtys: lineShip,
          received_qtys: lineRecv,
          received_at_hpd: !!line.received,
          received_at_hpd_at: line.received_at || null,
          _shipmentId: shipmentId,
          _lineId: line.id,
          _boxReceived: !!line.received,
          _itemFullyReceived: base.received_at_hpd,   // item cumulative (all boxes in)
          _cumReceivedQtys: base.received_qtys || {},
        });
      }
      if (boxItems.length === 0) continue;
      const first = boxItems[0];
      groups.set(shipmentId, {
        key: shipmentId,
        decorator_id: box?.decorator_id ?? first.decorator_id,
        decorator_name: first.decorator_name || "Unassigned",
        short_code: first.decorator_short_code || "",
        tracking: normalizeTracking(box?.tracking) ,
        pickup: !!box?.pickup,
        items: boxItems,
        jobIds: new Set(boxItems.map(it => it.job_id)),
        // The box's own ship date — its creation, i.e. when THIS wave shipped
        // (item.ship_date is first-set-wins and wrong for a later box).
        shippedAtCandidates: [box?.created_at || first.ship_date].filter(Boolean) as string[],
        receivedAtOverride: box?.received_at || null,
      });
    }

    // ── Legacy fallback: items with no persisted line, grouped the old way ─
    for (const j of jobs) {
      for (const it of j.items) {
        if (coveredItemIds.has(it.id)) continue;
        const key = "legacy::" + groupKeyFor(it);
        let acc = groups.get(key);
        if (!acc) {
          acc = {
            key,
            decorator_id: it.decorator_id,
            decorator_name: it.decorator_name || "Unassigned",
            short_code: it.decorator_short_code || "",
            tracking: normalizeTracking(it.ship_tracking),
            items: [],
            jobIds: new Set<string>(),
            shippedAtCandidates: [],
          };
          groups.set(key, acc);
        }
        acc.items.push(it);
        acc.jobIds.add(it.job_id);
        if (it.ship_date) acc.shippedAtCandidates.push(it.ship_date);
      }
    }

    // Materialize. Stable, deterministic ordering for downstream sort —
    // shipped_at ascending (oldest pending first) is what the receiving
    // page wants; consumer can re-sort if needed.
    const out: Shipment[] = [];
    for (const acc of Array.from(groups.values())) {
      const items = acc.items;
      // Units in the box = what was shipped in it (box-scoped ship_qtys), not the
      // item's whole order. Falls back to ordered for legacy items with no ship_qtys.
      const total_units = items.reduce((a, it) => a + (tQty(it.ship_qtys) || tQty(it.qtys)), 0);
      const pending_count = items.filter(it => !it.received_at_hpd).length;
      const received_count = items.length - pending_count;
      // Variance is meaningful only for received items. Compare what
      // was received against what shipped (fallback to ordered qty
      // when ship_qtys is empty — matches the receive modal's display).
      let variance_units = 0;
      for (const it of items) {
        if (!it.received_at_hpd) continue;
        const expected = tQty(it.ship_qtys) || tQty(it.qtys);
        const received = tQty(it.received_qtys) || expected;
        variance_units += received - expected;
      }
      const shipped_at = acc.shippedAtCandidates.length > 0
        ? acc.shippedAtCandidates.sort()[0]
        : null;
      // Earliest received timestamp across items that are received.
      // Bulk receives land all items within the same millisecond so this
      // is essentially "when the box was processed"; for partials it
      // surfaces the first item's receive time.
      const receivedAtCandidates = items
        .filter(it => it.received_at_hpd && it.received_at_hpd_at)
        .map(it => it.received_at_hpd_at as string);
      const received_at = acc.receivedAtOverride
        || (receivedAtCandidates.length > 0 ? receivedAtCandidates.sort()[0] : null);
      const jobsForShipment = Array.from(acc.jobIds).map(id => {
        const j = jobIndex.get(id);
        if (!j) return null;
        return {
          id: j.id,
          job_number: j.job_number,
          title: j.title,
          client_name: j.client_name,
          shipping_route: j.shipping_route,
          display_number: j.display_number,
        };
      }).filter(Boolean) as Shipment["jobs"];

      out.push({
        key: acc.key,
        decorator_id: acc.decorator_id,
        decorator_name: acc.decorator_name,
        short_code: acc.short_code,
        tracking: acc.tracking,
        pickup: acc.pickup ?? items.some(it => it.pickup_ready),
        shipped_at,
        received_at,
        items,
        jobs: jobsForShipment,
        total_items: items.length,
        total_units,
        pending_count,
        received_count,
        variance_units,
        all_received: pending_count === 0 && received_count > 0,
      });
    }

    // Sort: pending first (any pending_count > 0), then by shipped_at asc
    // (oldest pending = "where's that box from last week" comes to the top).
    // Fully-received shipments fall to the bottom, also by shipped_at.
    out.sort((a, b) => {
      const aPending = a.pending_count > 0 ? 0 : 1;
      const bPending = b.pending_count > 0 ? 0 : 1;
      if (aPending !== bPending) return aPending - bPending;
      const aTs = a.shipped_at || "9999";
      const bTs = b.shipped_at || "9999";
      return aTs.localeCompare(bTs);
    });

    return out;
  }, [jobs]);
}
