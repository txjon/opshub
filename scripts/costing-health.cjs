#!/usr/bin/env node
// COSTING HEALTH TRIPWIRE — read-only. Run anytime: `node scripts/costing-health.cjs`
// Exit 0 = clean, exit 1 = drift found (cron/CI-friendly).
//
// Checks the ONE invariant that must always hold, regardless of decorator-rate
// era: a job's reported revenue must equal the sum of the prices you actually
// charge. costing_summary.grossRev == Σ(items.sell_per_unit × qty) over
// non-passthrough items. sell_per_unit is the source of truth (quote/invoice/QB
// all read it); grossRev is a derived cache that every V2 write path must keep in
// step. Any mismatch = a write path forgot to refresh the summary (the Jul 28
// bug class) — surfaced in seconds instead of when a client notices.
//
// Also flags fleece items whose costProd never caught isFleece (potential
// under-price — the vendor upcharge + shipping buffer weren't applied).
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Known-correct exceptions (confirmed against QB). Keep this list tiny + documented.
const SKIP = new Set([
  "HPD-2606-040", // passthrough/wave edge case — correct to QB (Jon, Jul 28)
]);

(async () => {
  const { data: jobs, error } = await sb
    .from("jobs")
    .select("job_number, phase, costing_data, costing_summary, items(id, name, is_fleece, sell_per_unit, buy_sheet_lines(qty_ordered))")
    .not("costing_summary", "is", null);
  if (error) { console.error("query failed:", error.message); process.exit(2); }

  const drift = [], fleeceGaps = [];
  let consistent = 0, skipped = 0;

  for (const j of jobs || []) {
    const gr = Number(j.costing_summary?.grossRev);
    const cps = j.costing_data?.costProds || [];
    const passthru = new Set(cps.filter(p => p.passthrough).map(p => p.id));

    // fleece cross-check: item flagged fleece but costProd never got it
    for (const it of j.items || []) {
      if (!it.is_fleece) continue;
      const cp = cps.find(c => c.id === it.id) || cps.find(c => (c.name || "").trim().toLowerCase() === (it.name || "").trim().toLowerCase());
      if (cp && !cp.isFleece) fleeceGaps.push(`${j.job_number} · ${it.name || "?"} (${j.phase})`);
    }

    if (!gr) continue;
    // target = Σ sell_per_unit × qty over NON-passthrough items (matches grossRev)
    let target = 0;
    for (const it of j.items || []) {
      if (passthru.has(it.id)) continue;
      const q = (it.buy_sheet_lines || []).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0);
      target += (Number(it.sell_per_unit) || 0) * q;
    }
    target = Math.round(target * 100) / 100;
    if (target === 0) continue; // unpriced job — nothing to compare
    const delta = Math.round((gr - target) * 100) / 100;

    if (Math.abs(delta) <= 1) { consistent++; continue; }
    if (SKIP.has(j.job_number)) { skipped++; continue; }
    drift.push({ job: j.job_number, phase: j.phase, grossRev: gr, target, delta });
  }

  drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  console.log(`\n  COSTING HEALTH  ·  ${new Date().toISOString().slice(0, 16).replace("T", " ")}`);
  console.log(`  ${"─".repeat(52)}`);
  console.log(`  grossRev == Σ(sell × qty):  ${consistent} consistent  ·  ${drift.length} DRIFTED  ·  ${skipped} known-exception`);
  if (drift.length) {
    console.log("\n  DRIFTED (a write path left the summary stale):");
    for (const d of drift) console.log(`    ${d.job.padEnd(14)} ${String(d.phase).padEnd(11)} grossRev $${d.grossRev}  should be $${d.target}  (Δ$${d.delta})`);
  }
  if (fleeceGaps.length) {
    console.log(`\n  FLEECE not applied in costing (possible under-price): ${fleeceGaps.length}`);
    for (const f of fleeceGaps.slice(0, 15)) console.log(`    ${f}`);
  }
  console.log("");
  process.exit(drift.length ? 1 : 0);
})();
