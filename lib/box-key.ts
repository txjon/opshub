// Box identity — pure helpers shared by the browser boards AND server routes
// (vendor portal mark-shipped, tracking cron). They used to live in
// lib/use-shipments.ts, which is "use client": importing that from a server
// route hands back client-reference proxies, so shipmentGroupKey "was not a
// function" and every vendor-portal ship failed to create a box (found Sep 17
// 2026 on the Silencer split). Nothing here touches React or the browser.

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
