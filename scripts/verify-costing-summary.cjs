#!/usr/bin/env node
// Verification harness for lib/costing-summary (Tier 2): recompute every
// job's summary via the server mirror and diff against what CostingTab
// stored. Exact matches prove the mirror; mismatches are either stale
// summaries (the bug being fixed) or mirror drift. READ-ONLY.
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function main() {
  const { computeCostingSummary } = await import("../lib/costing-summary.ts");
  const { buildPrintersMap } = await import("../lib/pricing.ts");
  const [{ data: jobs }, { data: decorators }] = await Promise.all([
    sb.from("jobs").select("job_number, phase, costing_data, costing_summary, type_meta"),
    sb.from("decorators").select("*"),
  ]);
  const printers = buildPrintersMap(decorators || []);
  let exact = 0, close = 0, diff = 0, noCosting = 0;
  const diffs = [];
  for (const j of jobs || []) {
    if (!j.costing_data?.costProds?.length) { noCosting++; continue; }
    const mine = computeCostingSummary(j.costing_data, j.type_meta?.invoice_extra_lines, printers);
    const stored = j.costing_summary || {};
    if (!mine) { noCosting++; continue; }
    const keys = ["grossRev", "totalCost", "netProfit", "feeRevenue", "passthruTotal"];
    const deltas = keys.map(k => ({ k, d: Math.abs((Number(mine[k]) || 0) - (Number(stored[k]) || 0)) }));
    const maxD = Math.max(...deltas.map(x => x.d));
    if (maxD <= 0.011) exact++;
    else if (maxD <= 1) close++;
    else { diff++; diffs.push({ job: j.job_number, phase: j.phase, worst: deltas.sort((a,b)=>b.d-a.d)[0], mine: mine.grossRev, stored: stored.grossRev }); }
  }
  console.log(`jobs: ${(jobs||[]).length} · no-costing: ${noCosting} · EXACT: ${exact} · within-$1: ${close} · DIFFER: ${diff}`);
  for (const d of diffs.slice(0, 15)) console.log(`  ${d.job} (${d.phase}) worst field ${d.worst.k} Δ$${d.worst.d.toFixed(2)} — mine gross ${d.mine} vs stored ${d.stored}`);
}
main().catch(e => { console.error(e); process.exit(1); });
