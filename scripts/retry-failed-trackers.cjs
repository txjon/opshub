#!/usr/bin/env node
/**
 * One-off: retry the 5 boxes that failed tracker creation before the
 * default-carrier fix (carrier "FedEx" → "FedExDefault"). The smoke-test
 * tracker created manually for 874148899410 is attached directly (no
 * duplicate billing); the rest get their error/attempt flags cleared and go
 * back through ensureTracker. Re-runnable: boxes with a tracker id are
 * skipped by ensureTracker's guards.
 *
 * Usage: node --import tsx scripts/retry-failed-trackers.cjs
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SMOKE_TEST = { tracking: "874148899410", trackerId: "trk_f260ec5e074345cc90bc9da01f2ded6f" };

async function main() {
  const { ensureTracker, applyTrackerPayload } = await import("../lib/inbound-tracking.ts");
  const { data: boxes } = await sb.from("shipments")
    .select("id, tracking, carrier, tracking_error, easypost_tracker_id, decorators(name)")
    .eq("direction", "inbound").neq("status", "received")
    .not("tracking_error", "is", null).is("easypost_tracker_id", null);
  if (!boxes?.length) { console.log("no errored boxes to retry"); return; }
  console.log(`${boxes.length} errored box(es):`);

  for (const b of boxes) {
    if (b.tracking === SMOKE_TEST.tracking) {
      // attach the smoke-test tracker instead of creating (and paying for) a twin
      const key = process.env.EASYPOST_API_KEY || "";
      const res = await fetch(`https://api.easypost.com/v2/trackers/${SMOKE_TEST.trackerId}`, {
        headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") },
      });
      const tracker = await res.json();
      if (!res.ok) { console.log(`  ${b.tracking}: fetch smoke-test tracker failed`); continue; }
      await sb.from("shipments").update({
        easypost_tracker_id: tracker.id, tracking_error: null,
      }).eq("id", b.id);
      await applyTrackerPayload(sb, b.id, tracker);
      console.log(`  ${b.tracking}: ATTACHED smoke-test tracker (${tracker.status})`);
      continue;
    }
    await sb.from("shipments").update({ tracking_error: null, tracker_attempted_at: null }).eq("id", b.id);
    const r = await ensureTracker(sb, b.id);
    console.log(`  ${b.tracking} (${b.carrier}): ${r.created ? "TRACKER CREATED" : r.reason}`);
  }

  const { data: after } = await sb.from("shipments")
    .select("tracking, carrier_status, carrier_detected, est_delivery_date, delivered_at, tracking_error")
    .eq("direction", "inbound").neq("status", "received").not("easypost_tracker_id", "is", null);
  console.log("\ntracked open inbound boxes:");
  for (const b of after || []) {
    console.log(`  ${b.tracking} · ${b.carrier_detected || "?"} · ${b.carrier_status || "?"} · est ${b.est_delivery_date || "-"} · delivered ${b.delivered_at ? b.delivered_at.slice(0, 10) : "-"}${b.tracking_error ? " · ERR " + b.tracking_error : ""}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
