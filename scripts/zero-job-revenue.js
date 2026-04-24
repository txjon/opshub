#!/usr/bin/env node
/**
 * Zero out items.sell_per_unit for every item on a given job, and
 * clear the cached costing_summary revenue fields so total revenue
 * reports $0. Costing inputs (blanks, decoration, margins) are
 * untouched — those are still real costs we need for reporting.
 *
 * Usage:
 *   node scripts/zero-job-revenue.js <job_number>           # dry run
 *   node scripts/zero-job-revenue.js <job_number> --apply   # apply
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const jobNumber = process.argv[2];
const APPLY = process.argv.includes("--apply");
if (!jobNumber) {
  console.error("Usage: node scripts/zero-job-revenue.js <job_number> [--apply]");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  console.log(APPLY ? "APPLYING.\n" : "DRY RUN — use --apply to write.\n");

  const { data: job } = await sb
    .from("jobs")
    .select("id, title, job_number, costing_data, costing_summary, type_meta")
    .eq("job_number", jobNumber)
    .single();
  if (!job) { console.error(`Job ${jobNumber} not found`); process.exit(1); }
  console.log(`Job: ${job.job_number} — "${job.title}"  (${job.id})`);

  const { data: items } = await sb
    .from("items")
    .select("id, name, sell_per_unit")
    .eq("job_id", job.id)
    .order("sort_order");

  console.log(`\n${items?.length || 0} items:`);
  (items || []).forEach(it => console.log(`  ${it.name}  current sell=${it.sell_per_unit ?? "null"}`));

  const grossRev = (job.costing_summary || {}).grossRev;
  console.log(`\ncosting_summary.grossRev before: ${grossRev ?? "null"}`);
  const qbTotal = (job.type_meta || {}).qb_total_with_tax;
  if (qbTotal != null) console.log(`type_meta.qb_total_with_tax: ${qbTotal} (will NOT touch — QB is source of truth)`);

  if (!APPLY) {
    console.log("\nPlan:");
    console.log("  - Set items.sell_per_unit = 0 on all items");
    console.log("  - Clear costing_summary.grossRev and derived metrics (margin, netProfit, avgPerUnit)");
    console.log("  - Zero sellOverride on every costProd in costing_data");
    console.log("  - Leave costing inputs (blanks, printing, margins) alone");
    console.log("\nDry run. Re-run with --apply to write.");
    return;
  }

  // 1. Zero sell_per_unit on items
  const { error: itemErr } = await sb.from("items")
    .update({ sell_per_unit: 0 })
    .eq("job_id", job.id);
  if (itemErr) { console.error("items update failed:", itemErr.message); process.exit(1); }
  console.log("\n✓ All items sell_per_unit = 0");

  // 2. Patch costing_data.costProds to zero sellOverride
  const costingData = (job.costing_data || {});
  const costProds = Array.isArray(costingData.costProds) ? costingData.costProds : [];
  const newCostProds = costProds.map(cp => ({ ...cp, sellOverride: 0 }));
  const newCostingData = { ...costingData, costProds: newCostProds };

  // 3. Zero the cached revenue metrics in costing_summary. Keep totalCost +
  //    totalQty so cost reporting still reflects reality.
  const prevSummary = (job.costing_summary || {});
  const newSummary = {
    ...prevSummary,
    grossRev: 0,
    netProfit: 0 - (Number(prevSummary.totalCost) || 0),
    margin: 0,
    avgPerUnit: 0,
  };

  const { error: jobErr } = await sb.from("jobs")
    .update({ costing_data: newCostingData, costing_summary: newSummary })
    .eq("id", job.id);
  if (jobErr) { console.error("job update failed:", jobErr.message); process.exit(1); }
  console.log("✓ costing_summary grossRev/margin zeroed, totalCost preserved");
  console.log("✓ costing_data.costProds sellOverride = 0 on all entries");
  console.log(`\nDone. Job ${jobNumber} total revenue now $0. Costing inputs preserved.`);
})().catch(e => { console.error(e); process.exit(1); });
