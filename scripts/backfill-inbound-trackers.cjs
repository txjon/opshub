#!/usr/bin/env node
/**
 * One-time (re-runnable) tracker backfill: register EasyPost trackers for
 * OPEN inbound boxes that have a real tracking number and no tracker yet.
 * ensureTracker's guards make this idempotent and billing-safe — re-running
 * creates nothing new. Dry-run by default.
 *
 * Usage: node scripts/backfill-inbound-trackers.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { ensureTracker } = await import("../lib/inbound-tracking.ts");
  const { data: boxes } = await sb.from("shipments")
    .select("id, tracking, carrier, pickup, status, easypost_tracker_id, tracker_attempted_at, decorators(name)")
    .eq("direction", "inbound").neq("status", "received");
  const candidates = (boxes || []).filter(b =>
    !b.easypost_tracker_id && !b.tracker_attempted_at && !b.pickup && b.tracking);
  console.log(`${(boxes || []).length} open inbound boxes; ${candidates.length} candidate(s):`);
  for (const b of candidates) console.log(`  ${b.decorators?.name || "?"} · ${b.carrier || "-"} · ${b.tracking}`);
  if (!APPLY) { console.log("\nDry run — --apply to register (ensureTracker guards still apply per box)."); return; }
  for (const b of candidates) {
    const r = await ensureTracker(sb, b.id);
    console.log(`  ${b.tracking}: ${r.created ? "TRACKER CREATED" : r.reason}`);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
