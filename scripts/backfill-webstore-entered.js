#!/usr/bin/env node
/**
 * Backfill items.webstore_entered_at for stage-route jobs that are
 * already "at HPD" (items received, no fulfillment_status="shipped")
 * but were stuck because OpsHub had no signal for "handed off to
 * Shopify." Migration 078 added the column; this script flips the
 * flag on stale received items so phase recalc can land those jobs
 * at "complete."
 *
 * Targets:
 *   - jobs.shipping_route = "stage" (job-level)
 *   - jobs.phase IN ("receiving", "fulfillment", "shipping")
 *     (not already complete/cancelled)
 *   - items.received_at_hpd = true
 *   - items.webstore_entered_at IS NULL
 *   - the item's effective route resolves to stage
 *
 * The script does NOT touch:
 *   - drop_ship / ship_through jobs
 *   - items that aren't yet received at HPD
 *   - items already entered (idempotent)
 *
 * It DOES NOT send any client emails — webstore entry has no email
 * side effect, so backfill is silent.
 *
 * Usage:
 *   node scripts/backfill-webstore-entered.js          # dry run
 *   node scripts/backfill-webstore-entered.js --apply  # commit
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: stageJobs, error: jobErr } = await sb
    .from("jobs")
    .select("id, job_number, title, phase, shipping_route, clients(name)")
    .eq("shipping_route", "stage")
    .in("phase", ["receiving", "fulfillment", "shipping"]);
  if (jobErr) { console.error("query failed:", jobErr); process.exit(1); }
  if (!stageJobs || stageJobs.length === 0) {
    console.log("No stage jobs stuck in receiving/fulfillment/shipping.");
    return;
  }

  console.log(`Found ${stageJobs.length} stage job${stageJobs.length === 1 ? "" : "s"} to inspect.\n`);

  let totalItems = 0;
  let totalFlipped = 0;
  const now = new Date().toISOString();

  for (const j of stageJobs) {
    const { data: items } = await sb
      .from("items")
      .select("id, name, received_at_hpd, webstore_entered_at, shipping_route")
      .eq("job_id", j.id);
    if (!items || items.length === 0) continue;

    // Effective route resolver — same logic as useWarehouse loader.
    const candidates = items.filter(it => {
      const effective = it.shipping_route || j.shipping_route;
      return effective === "stage"
        && it.received_at_hpd === true
        && !it.webstore_entered_at;
    });

    if (candidates.length === 0) continue;

    totalItems += candidates.length;
    const clientName = j.clients?.name || "—";
    console.log(`  ${APPLY ? "FIX " : "WOULD"}  ${j.job_number}  ${clientName}  ${j.title.slice(0, 40)}  ·  ${candidates.length} item${candidates.length === 1 ? "" : "s"}`);
    for (const it of candidates) {
      console.log(`           ↳ ${it.name}`);
    }

    if (APPLY) {
      const ids = candidates.map(it => it.id);
      const { error } = await sb
        .from("items")
        .update({ webstore_entered_at: now })
        .in("id", ids);
      if (error) {
        console.error("    UPDATE FAILED:", error.message);
      } else {
        totalFlipped += candidates.length;
        // Activity log per job
        await sb.from("job_activity").insert({
          job_id: j.id,
          user_id: null,
          type: "auto",
          message: `${candidates.length} item${candidates.length === 1 ? "" : "s"} backfilled as Shopify-entered (clearing stuck "at HPD" state)`,
        });
      }
    }
  }

  console.log(`\n${APPLY ? "Applied" : "Would apply"}: ${APPLY ? totalFlipped : totalItems} item${totalItems === 1 ? "" : "s"} across ${stageJobs.length} job${stageJobs.length === 1 ? "" : "s"}.`);
  if (APPLY) {
    console.log("\nPhase recalc happens on next load of /receiving, /jobs/[id], or any page that touches calculatePhase. To force right now, the app can be reloaded.");
  } else {
    console.log("\nRe-run with --apply to commit.");
  }
})();
