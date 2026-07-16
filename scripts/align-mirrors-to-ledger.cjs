#!/usr/bin/env node
/**
 * Align legacy item mirror flags to LEDGER truth (Jon, 2026-07-16: "all
 * pre-phase data lines up with the current new phase map").
 *
 * The mig-120 backfill created ledger movements but never back-stamped the
 * legacy flags the phase engine reads, so jobs stick in wrong phases
 * (HPD-2605-026: one item's unset webstore_entered_at held a done job in
 * fulfillment). FORWARD-ONLY rules — flags gain progress, never lose it:
 *   - received_at_hpd:      false -> true   when ledger fullyReceived (shipped>0)
 *   - webstore_entered_at:  NULL  -> latest stage-movement time, when ledger
 *                           shows the item fully entered (stage route)
 *   - forwarded_at:         NULL  -> latest forward-movement time, when ledger
 *                           shows fully forwarded (ship_through route)
 *   - pipeline_stage:       -> 'shipped' when ledger closed with shipped>0
 * Then recalc jobs.phase for every NON-terminal job (complete/cancelled/
 * on_hold stored phases are never touched or recalced).
 *
 * Usage: node scripts/align-mirrors-to-ledger.cjs           # dry run
 *        node scripts/align-mirrors-to-ledger.cjs --apply
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const sum = q => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const net = (mvs, type) => {
  const out = {};
  for (const m of mvs) { if (m.type !== type) continue; for (const [s, n] of Object.entries(m.qtys || {})) out[s] = (out[s] || 0) + (Number(n) || 0); }
  return out;
};

(async () => {
  const { data: jobs } = await sb.from("jobs").select("id, job_number, phase, shipping_route, clients(name)");
  const byId = new Map(jobs.map(j => [j.id, j]));
  const { data: items } = await sb.from("items")
    .select("id, job_id, name, ship_final, pipeline_stage, received_at_hpd, webstore_entered_at, forwarded_at, shipping_route, buy_sheet_lines(size, qty_ordered)");
  const ids = items.map(i => i.id);
  const moves = [];
  for (let i = 0; i < ids.length; i += 400) {
    const { data } = await sb.from("movements").select("item_id, type, qtys, created_at").in("item_id", ids.slice(i, i + 400));
    moves.push(...(data || []));
  }
  const movesByItem = new Map();
  for (const m of moves) { const a = movesByItem.get(m.item_id) || []; a.push(m); movesByItem.set(m.item_id, a); }

  const fixes = [];
  for (const it of items) {
    const mv = movesByItem.get(it.id) || [];
    if (!mv.length) continue;
    const job = byId.get(it.job_id); if (!job) continue;
    const route = it.shipping_route || job.shipping_route || "ship_through";
    const ordered = {}; for (const l of it.buy_sheet_lines || []) ordered[l.size] = (ordered[l.size] || 0) + (Number(l.qty_ordered) || 0);
    const shipped = sum(net(mv, "ship")), received = sum(net(mv, "receive"));
    const entered = sum(net(mv, "stage")), forwarded = sum(net(mv, "forward"));
    const closed = !!it.ship_final || (shipped > 0 && shipped >= sum(ordered));
    const fullyReceived = shipped > 0 && received >= shipped;
    const patch = {};
    if (!it.received_at_hpd && route !== "drop_ship" && fullyReceived) patch.received_at_hpd = true;
    if (!it.webstore_entered_at && route === "stage" && entered > 0 && received > 0 && entered >= received) {
      const ts = mv.filter(m => m.type === "stage").map(m => m.created_at).sort().pop();
      if (ts) patch.webstore_entered_at = ts;
    }
    if (!it.forwarded_at && route === "ship_through" && forwarded > 0 && received > 0 && forwarded >= received) {
      const ts = mv.filter(m => m.type === "forward").map(m => m.created_at).sort().pop();
      if (ts) patch.forwarded_at = ts;
    }
    if (it.pipeline_stage !== "shipped" && closed && shipped > 0) patch.pipeline_stage = "shipped";
    if (Object.keys(patch).length) fixes.push({ it, job, patch });
  }

  console.log(`${fixes.length} item(s) with stale mirror flags:`);
  for (const f of fixes) console.log(`  ${f.job.job_number} (${f.job.phase}) ${f.it.name}: ${Object.entries(f.patch).map(([k, v]) => `${k}→${String(v).slice(0, 10)}`).join(", ")}`);

  if (!APPLY) { console.log("\nDry run — re-run with --apply."); return; }
  for (const f of fixes) {
    const { error } = await sb.from("items").update(f.patch).eq("id", f.it.id);
    if (error) { console.error(`  ERROR ${f.it.name}: ${error.message}`); process.exit(1); }
  }
  console.log("flags applied.");
})().catch(e => { console.error(e); process.exit(1); });
