#!/usr/bin/env node
// QB RECONCILIATION — is any job out of sync with the QuickBooks truth?
//
// QuickBooks is where real money was exchanged; its invoice total is the truth.
// This compares, per job that has a QB invoice, OpsHub's computed billable
// against QB's stored total (type_meta.qb_total_with_tax — OpsHub's synced copy
// of QB from the last push/readback).
//
// It computes OpsHub's billable TWO ways to isolate the 028 bug class:
//   billableBSL     = sell_per_unit x buy_sheet_lines.qty   (the SINGLE-SOURCE target)
//   billableCosting = sell_per_unit x costing_data qtys     (the drift-prone source)
// If those two disagree, that job is drifting internally RIGHT NOW.
// If either disagrees with QB, the job is out of sync with the money truth
// (could be a real bug OR a legit revision not re-pushed — flagged, not judged).
//
// READ ONLY. Touches nothing. Run: node scripts/qb-reconcile.cjs [--all]
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const C = 0.01; // cent tolerance
const sumQ = o => Object.values(o || {}).reduce((a, v) => a + (Number(v) || 0), 0);
const money = n => "$" + (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const norm = n => (n || "").trim().toLowerCase();

(async () => {
  const { data: jobs, error } = await s.from("jobs")
    .select("id, job_number, phase, type_meta, costing_data")
    .not("type_meta", "is", null);
  if (error) { console.error(error.message); process.exit(1); }

  // Jobs that were actually invoiced in QB
  const qbJobs = (jobs || []).filter(j => {
    const tm = j.type_meta || {};
    return tm.qb_invoice_number || tm.qb_invoice_id || (Number(tm.qb_total_with_tax) || 0) > 0;
  });
  const ids = qbJobs.map(j => j.id);

  // items + buy_sheet_lines for those jobs
  const itemsByJob = {};
  for (let i = 0; i < ids.length; i += 100) {
    const { data: items } = await s.from("items")
      .select("id, name, job_id, sell_per_unit, buy_sheet_lines(size, qty_ordered)")
      .in("job_id", ids.slice(i, i + 100));
    (items || []).forEach(it => { (itemsByJob[it.job_id] ||= []).push(it); });
  }

  const outOfSyncQB = [];   // OpsHub billable != QB stored total
  const internalDrift = []; // buy_sheet_lines qty != costing_data qty (live 028)
  let clean = 0;

  for (const j of qbJobs) {
    const tm = j.type_meta || {};
    const items = itemsByJob[j.id] || [];
    const byId = Object.fromEntries(items.map(it => [it.id, it]));
    const byName = {}; items.forEach(it => { byName[norm(it.name)] = it; });

    // billable from buy_sheet_lines (the target source)
    let billableBSL = 0;
    for (const it of items) {
      const q = (it.buy_sheet_lines || []).reduce((a, l) => a + (Number(l.qty_ordered) || 0), 0);
      billableBSL += (Number(it.sell_per_unit) || 0) * q;
    }
    // billable from costing_data qtys (the drift-prone source)
    let billableCosting = 0;
    const cps = j.costing_data?.costProds || [];
    for (const cp of cps) {
      const it = byId[cp.id] || byName[norm(cp.name)];
      if (!it) continue;
      billableCosting += (Number(it.sell_per_unit) || 0) * sumQ(cp.qtys);
    }
    const extras = (Array.isArray(tm.invoice_extra_lines) ? tm.invoice_extra_lines : [])
      .reduce((a, l) => a + (Number(l?.amount) || 0), 0);
    billableBSL = Math.round((billableBSL + extras) * 100) / 100;
    billableCosting = Math.round((billableCosting + extras) * 100) / 100;

    const qbSubtotal = Math.round(((Number(tm.qb_total_with_tax) || 0) - (Number(tm.qb_tax_amount) || 0)) * 100) / 100;
    const variancePushed = !!(tm.qb_variance_pushed_at || tm.stripe_variance_pushed_at);

    // internal drift = the two OpsHub sources disagree NOW
    if (Math.abs(billableBSL - billableCosting) > C) {
      internalDrift.push({ job: j.job_number, phase: j.phase, buySheet: money(billableBSL), costing: money(billableCosting), diff: money(billableBSL - billableCosting) });
    }
    // out of sync with QB (compare the target source to QB), with self-triage:
    //   variance → billed on actuals, a diff from ordered qty is EXPECTED
    //   grew     → OpsHub HIGHER than QB: order was added to since invoicing,
    //              just not re-synced yet. Benign — needs a re-push, not a fix.
    //   review   → OpsHub LOWER than (or otherwise off from) QB: the client was
    //              billed more than OpsHub now shows — a discount not mirrored, a
    //              direct-in-QB edit, or a real problem. THIS is what to look at.
    if (qbSubtotal > 0 && Math.abs(billableBSL - qbSubtotal) > C) {
      const diffN = Math.round((billableBSL - qbSubtotal) * 100) / 100;
      const category = variancePushed ? "variance" : diffN > 0 ? "grew" : "review";
      outOfSyncQB.push({ category, job: j.job_number, phase: j.phase, opsHub: money(billableBSL), qb: money(qbSubtotal), diff: money(diffN), variancePushed });
    } else if (qbSubtotal > 0) {
      clean++;
    }
  }

  const P = (arr, n = 60) => { arr.slice(0, n).forEach(r => console.log("   ", JSON.stringify(r))); if (arr.length > n) console.log(`    …+${arr.length - n} more (capped)`); };
  console.log("========= QB RECONCILIATION =========");
  console.log(`QB-invoiced jobs scanned: ${qbJobs.length}  |  in sync with QB: ${clean}`);
  console.log("(QB total = OpsHub's stored copy type_meta.qb_total_with_tax; a live QB API read is the deeper check for direct-in-QB edits.)");
  console.log("");
  console.log(`### INTERNAL DRIFT NOW (buy_sheet_lines qty != costing_data qty) — live 028s: ${internalDrift.length}`);
  P(internalDrift);

  const grew = outOfSyncQB.filter(r => r.category === "grew");
  const variance = outOfSyncQB.filter(r => r.category === "variance");
  const review = outOfSyncQB.filter(r => r.category === "review");
  console.log("");
  console.log(`### OUT OF SYNC WITH QB: ${outOfSyncQB.length}  (variance ${variance.length} · grew ${grew.length} · review ${review.length})`);
  console.log("");
  console.log(`  ⚠  REVIEW — OpsHub BELOW QB (client billed more than OpsHub shows; discount/direct-QB-edit/bug): ${review.length}`);
  P(review);
  console.log("");
  console.log(`  ↑  GREW — OpsHub ABOVE QB (order added to since invoicing, needs a re-push; benign): ${grew.length}`);
  P(grew);
  console.log("");
  console.log(`  =  VARIANCE — billed on actual received/shipped qty (a diff from ordered is expected): ${variance.length}`);
  P(variance);
})();
