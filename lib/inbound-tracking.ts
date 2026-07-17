// Live inbound tracking — EasyPost trackers on shipment boxes (plan locked
// 2026-07-16, D1-D4). SERVER-ONLY: uses EASYPOST_API_KEY.
//
// ensureTracker is the ONLY place trackers are created — that single choke
// point is the billing safety (EasyPost bills ~2-3¢ once per tracker at
// creation). Guards, in order:
//   1. box already has a tracker id            → no-op
//   2. box already had a registration attempt  → no-op (no retry loops)
//   3. no real tracking number (isRealTracking fences "Freight", "MULTIPLE —
//      SEE ATTACHMENT", etc.) or pickup box    → untrackable-by-design, no-op
//   4. same number+carrier already tracked on another box → SHARE that
//      tracker id, create nothing
// Failures (bad number, unknown carrier) → shipments.tracking_error, shown as
// an error state on the box; never retried automatically.
//
// delivered_at is a carrier SIGNAL. received_at is human-only. This module
// never touches received state.

import { isRealTracking } from "./use-shipments";
import { createHash } from "crypto";

const EP = "https://api.easypost.com/v2";

function epAuth(): string {
  const key = process.env.EASYPOST_API_KEY || "";
  return "Basic " + Buffer.from(key + ":").toString("base64");
}

export const scanKey = (trackerId: string, at: string, status: string, message: string) =>
  createHash("md5").update(`${trackerId}|${at}|${status}|${message}`).digest("hex");

// Write a tracker's scan history + summary onto its shipment. Idempotent:
// scans insert with ON CONFLICT DO NOTHING on scan_key; summary writes are
// last-write-wins from the same payload. Shared by the webhook and the
// creation path (the create response already carries any existing scans).
export async function applyTrackerPayload(sb: any, shipmentId: string, tracker: any): Promise<void> {
  const details: any[] = tracker.tracking_details || [];
  if (details.length) {
    const rows = details.map((d: any) => ({
      shipment_id: shipmentId,
      easypost_tracker_id: tracker.id,
      scan_key: scanKey(tracker.id, d.datetime || "", d.status || "", d.message || ""),
      status: d.status || null,
      description: d.message || null,
      location: [d.tracking_location?.city, d.tracking_location?.state].filter(Boolean).join(", ") || null,
      occurred_at: d.datetime || null,
    }));
    // upsert w/ ignoreDuplicates = ON CONFLICT DO NOTHING → webhook retries no-op
    await sb.from("tracking_events").upsert(rows, { onConflict: "scan_key", ignoreDuplicates: true });
  }
  const last = details.length ? details[details.length - 1] : null;
  const delivered = tracker.status === "delivered";
  const patch: any = {
    carrier_status: tracker.status || null,
    carrier_detected: tracker.carrier || null,
    est_delivery_date: tracker.est_delivery_date ? String(tracker.est_delivery_date).slice(0, 10) : null,
    est_delivery_updated_at: new Date().toISOString(),
    last_scan: last ? {
      status: last.status || null, description: last.message || null,
      location: [last.tracking_location?.city, last.tracking_location?.state].filter(Boolean).join(", ") || null,
      at: last.datetime || null,
    } : null,
    tracking_error: null,
  };
  if (delivered) {
    patch.delivered_at = last?.datetime || new Date().toISOString();
  }
  await sb.from("shipments").update(patch).eq("id", shipmentId);
}

export async function ensureTracker(sb: any, shipmentId: string): Promise<{ ok: boolean; created: boolean; reason?: string }> {
  const { data: box } = await sb.from("shipments")
    .select("id, tracking, carrier, pickup, easypost_tracker_id, tracker_attempted_at")
    .eq("id", shipmentId).single();
  if (!box) return { ok: false, created: false, reason: "no such shipment" };
  if (box.easypost_tracker_id) return { ok: true, created: false, reason: "already tracked" };
  if (box.tracker_attempted_at) return { ok: true, created: false, reason: "already attempted" };
  if (box.pickup || !isRealTracking(box.tracking)) return { ok: true, created: false, reason: "untrackable by design" };
  // freight/ocean boxes carry BOLs and vessel refs, not parcel tracking —
  // untrackable-by-design (NOT an error state; the manual chain owns them)
  if (/freight|ocean|ltl|bol|vessel|oocl|maersk|msc|cma|evergreen|hapag/i.test(box.carrier || "")) {
    await sb.from("shipments").update({ tracker_attempted_at: new Date().toISOString() }).eq("id", shipmentId);
    return { ok: true, created: false, reason: "freight/ocean — untrackable by design" };
  }

  // same number already tracked on another box (vendor reused a number) —
  // share the tracker instead of creating (and paying for) a duplicate
  const { data: twin } = await sb.from("shipments")
    .select("easypost_tracker_id").eq("tracking", box.tracking)
    .not("easypost_tracker_id", "is", null).neq("id", shipmentId).limit(1);
  if (twin?.length) {
    await sb.from("shipments").update({
      easypost_tracker_id: twin[0].easypost_tracker_id,
      tracker_attempted_at: new Date().toISOString(),
    }).eq("id", shipmentId);
    return { ok: true, created: false, reason: "shared existing tracker" };
  }

  // stamp the attempt FIRST — even a crash below can't cause a retry loop
  await sb.from("shipments").update({ tracker_attempted_at: new Date().toISOString() }).eq("id", shipmentId);

  const res = await fetch(`${EP}/trackers`, {
    method: "POST",
    headers: { Authorization: epAuth(), "Content-Type": "application/json" },
    body: JSON.stringify({ tracker: { tracking_code: box.tracking } }), // carrier auto-detect
  });
  const bodyJson = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = bodyJson?.error?.message || `EasyPost ${res.status}`;
    await sb.from("shipments").update({ tracking_error: msg.slice(0, 200) }).eq("id", shipmentId);
    return { ok: false, created: false, reason: msg };
  }
  await sb.from("shipments").update({ easypost_tracker_id: bodyJson.id }).eq("id", shipmentId);
  await applyTrackerPayload(sb, shipmentId, bodyJson);
  return { ok: true, created: true };
}
