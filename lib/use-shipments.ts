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

function normalizeTracking(raw: string | null | undefined): string | null {
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
  "local", "pickup", "local pickup", "hand delivery", "handdelivery", "delivered",
]);

export function isRealTracking(trk: string | null | undefined): boolean {
  return !!trk && !NON_TRACKING_TOKENS.has(trk.trim().toLowerCase());
}

function groupKeyFor(item: WarehouseItem): string {
  const decKey = item.decorator_id || item.decorator_name || "unassigned";
  const trk = normalizeTracking(item.ship_tracking);
  if (isRealTracking(trk)) return `${decKey}::${trk}`;
  // Fallback: bucket by (decorator, ship_date_day, job_id). Including
  // job_id here means a vendor that ships items for two different jobs
  // on the same day with no tracking gets two separate rows — which
  // matches reality (two distinct deliveries).
  const dateDay = item.ship_date ? item.ship_date.slice(0, 10) : "unknown";
  return `${decKey}::notrk:${dateDay}:${item.job_id}`;
}

export function useShipments(jobs: WarehouseJob[]): Shipment[] {
  return useMemo(() => {
    type Acc = {
      key: string;
      decorator_id: string | null;
      decorator_name: string;
      short_code: string;
      tracking: string | null;
      items: WarehouseItem[];
      jobIds: Set<string>;
      shippedAtCandidates: string[];
    };
    const groups = new Map<string, Acc>();

    // Index for job context lookup. WarehouseJob already carries title,
    // job_number, client_name, shipping_route, display_number — no
    // extra fetch needed.
    const jobIndex = new Map<string, WarehouseJob>();
    for (const j of jobs) jobIndex.set(j.id, j);

    for (const j of jobs) {
      for (const it of j.items) {
        const key = groupKeyFor(it);
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
      const total_units = items.reduce((a, it) => a + tQty(it.qtys), 0);
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
      const received_at = receivedAtCandidates.length > 0
        ? receivedAtCandidates.sort()[0]
        : null;
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
