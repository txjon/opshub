#!/usr/bin/env node
/**
 * 2026-08-11 (Jon's FINAL Olive slip): ADD the last 13th Heaven → FOG Ridgeline
 * wave. OLIVE Relaxed Long (x/34) + Tall/"Extra Long" (x/36), FedEx, ship 8/11.
 * Master 875600140724 (cartons W152-W155); per-carton waybills loaded as boxes
 * to match the Aug-10 load of the sibling master 875539644341 (W149-W151):
 *
 *   Box 875600140724  W152 = 51  Long  34:35 36:16
 *   Box 875600140735  W153 = 50  Long  30:7 36:20 38:23
 *   Box 875600140746  W154 = 52  Long  28:5 32:38 40:6 42:3
 *   Box 875600140757  W155 = 22  Long 32:3 · Tall 32:15 42:4   (9.7kg carton)
 *
 * ALREADY LOADED (excluded): W149-W151 = boxes 875539644363/875539644352/
 * 875539644341, Aug-10. Pack rows reconcile: Long 205 − 49 loaded = 156 new;
 * Tall 83 − 64 loaded = 19 new. Slip variance vs order: Long +1 every size
 * except 32/34 exact (+7); Tall 32:+1, 36/36:−3 SHORT, 38/36:+5 (13H make-up
 * units in the wrong size — Olive ends short 3× Rlx 36/36 Tall, 1× Rlx 34/32).
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-olive-longtall-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9";
const DECORATOR_NAME = "13th Heaven LLC";
const PRIOR_WAVE_WAYBILLS = ["875539644341", "875539644352", "875539644363", "875539644374"];

const OLIVE = "Olive Ridgeline Pant";
const RL = (w) => `Relaxed / ${w} / 34 (Long)`;
const RT = (w) => `Relaxed / ${w} / 36 (Tall)`;
const q = (fn, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fn(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const MASTERS = [
  { tracking: "875600140724", shipDate: "2026-08-11", items: { // W152
      [OLIVE]: q(RL, { 34: 35, 36: 16 }),                      // 51
  } },
  { tracking: "875600140735", shipDate: "2026-08-11", items: { // W153
      [OLIVE]: q(RL, { 30: 7, 36: 20, 38: 23 }),               // 50
  } },
  { tracking: "875600140746", shipDate: "2026-08-11", items: { // W154
      [OLIVE]: q(RL, { 28: 5, 32: 38, 40: 6, 42: 3 }),         // 52
  } },
  { tracking: "875600140757", shipDate: "2026-08-11", items: { // W155
      [OLIVE]: { ...q(RL, { 32: 3 }), ...q(RT, { 32: 15, 42: 4 }) }, // 22
  } },
];
const WAVE_EXPECT = { [OLIVE]: 175 };

async function main() {
  const handoff = await import("../lib/handoff.ts");
  const ledger = await import("../lib/inventory-ledger.ts");
  const { recalcJobPhase } = await import("../lib/job-phase-recalc.ts");
  const { ensureTracker } = await import("../lib/inbound-tracking.ts");

  const { data: job } = await sb.from("jobs").select("id, phase").eq("job_number", JOB_NUMBER).single();
  if (!job) throw new Error(`job ${JOB_NUMBER} not found`);
  const { data: items } = await sb.from("items").select("id, name, ship_qtys, received_qtys, ship_final, pipeline_stage").eq("job_id", job.id);
  const itemByName = new Map((items || []).map((i) => [i.name, i]));
  for (const m of MASTERS) for (const name of Object.keys(m.items))
    if (!itemByName.has(name)) throw new Error(`item not found on job: ${name}`);
  const { data: dec } = await sb.from("decorators").select("id, name").eq("id", DECORATOR_ID).single();
  if (!dec || !/13th heaven/i.test(dec.name)) throw new Error(`decorator mismatch (got ${dec?.name})`);
  for (const [name, n] of Object.entries(WAVE_EXPECT)) {
    const got = MASTERS.reduce((a, m) => a + (m.items[name] ? tot(m.items[name]) : 0), 0);
    if (got !== n) throw new Error(`wave sum for ${name} = ${got}, expected ${n}`);
  }
  for (const name of Object.keys(WAVE_EXPECT)) {
    const { data: bsl } = await sb.from("buy_sheet_lines").select("size").eq("item_id", itemByName.get(name).id);
    const ordered = new Set((bsl || []).map((l) => l.size));
    for (const m of MASTERS) for (const k of Object.keys(m.items[name] || {}))
      if (!ordered.has(k)) throw new Error(`no ordered buy_sheet_line for ${name} :: ${k}`);
  }
  const trackings = MASTERS.map((m) => m.tracking);
  const { data: dup } = await sb.from("shipments").select("id, tracking").in("tracking", trackings);
  if ((dup || []).length) throw new Error(`box(es) already exist for ${dup.map((d) => d.tracking).join(", ")} — aborting`);
  const { data: prior } = await sb.from("shipments").select("tracking").in("tracking", PRIOR_WAVE_WAYBILLS);
  if ((prior || []).length !== PRIOR_WAVE_WAYBILLS.length)
    throw new Error(`expected the Aug-10 W149-W151 boxes to already exist — found ${(prior || []).length}/4, check before loading`);

  console.log(`job ${JOB_NUMBER} (phase=${job.phase})  ·  decorator ${dec.name}`);
  console.log(`\nBEFORE:`);
  for (const name of Object.keys(WAVE_EXPECT)) {
    const it = itemByName.get(name);
    console.log(`  ${name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  }
  console.log(`\nPLANNED BOXES:`);
  for (const m of MASTERS) {
    console.log(`  ▸ Box ${m.tracking}  (FedEx, ship ${m.shipDate})`);
    for (const [name, qtys] of Object.entries(m.items)) {
      for (const [k, v] of Object.entries(qtys)) console.log(`      ${k.padEnd(28)} ${v}`);
      console.log(`      = ${tot(qtys)} pcs ${name}`);
    }
  }
  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write.\n"); return; }

  const lastTrackingByItem = new Map();
  const boxIds = [];
  console.log(`\napplying...`);
  for (const m of MASTERS) {
    const shipDateIso = `${m.shipDate}T12:00:00Z`;
    let boxId = null;
    for (const [name, qtys] of Object.entries(m.items)) {
      const it = itemByName.get(name);
      boxId = await handoff.upsertShipmentForItem(sb, {
        job_id: job.id, item_id: it.id, item_name: name,
        decorator_id: DECORATOR_ID, decorator_name: DECORATOR_NAME,
        pickup_ready: false, ship_tracking: m.tracking, ship_date: shipDateIso,
        ship_qtys: qtys, carrier: "FedEx",
      });
      if (!boxId) throw new Error(`box create failed for ${m.tracking} / ${name}`);
      await ledger.recordShip(sb, { itemId: it.id, jobId: job.id, waveQtys: qtys, shipmentId: boxId, tracking: m.tracking, description: name });
      lastTrackingByItem.set(it.id, m.tracking);
    }
    await sb.from("shipments").update({ created_at: shipDateIso }).eq("id", boxId);
    boxIds.push({ id: boxId, tracking: m.tracking });
    console.log(`  box ${m.tracking}: ${Object.entries(m.items).map(([n, qs]) => `${n.split(" ")[0]} ${tot(qs)}`).join(" + ")}`);
  }
  for (const [itemId, tracking] of Array.from(lastTrackingByItem.entries())) {
    const { data: st } = await sb.from("items").select("name, ship_qtys, pipeline_timestamps, buy_sheet_lines(qty_ordered), decorator_assignments(id)").eq("id", itemId).single();
    const shipped = sumMap(st.ship_qtys || {});
    const ordered = (st.buy_sheet_lines || []).reduce((a, b) => a + (Number(b.qty_ordered) || 0), 0);
    const closed = ordered > 0 && shipped >= ordered;
    const timestamps = { ...(st.pipeline_timestamps || {}), shipped: (st.pipeline_timestamps || {}).shipped || new Date().toISOString() };
    await sb.from("items").update({ ship_final: closed, pipeline_stage: closed ? "shipped" : "in_production", ship_tracking: tracking, pipeline_timestamps: timestamps }).eq("id", itemId);
    const daId = st.decorator_assignments?.[0]?.id;
    if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: closed ? "shipped" : "in_production", tracking_number: tracking }).eq("id", daId);
    console.log(`  item ${st.name}: shipped ${shipped}/${ordered} → ${closed ? "closed" : "open (more owed)"}`);
  }
  for (const b of boxIds) {
    try { const r = await ensureTracker(sb, b.id); console.log(`  tracker ${b.tracking}: ${r?.created ? "created" : (r?.reason || "skipped")}`); }
    catch (e) { console.log(`  tracker ${b.tracking}: skipped (${e.message})`); }
  }
  await recalcJobPhase(sb, job.id);
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added FINAL 13th Heaven Olive wave to receiving — 4 FedEx boxes (master 140724, cartons W152-W155), 175 pcs [Rlx Long 156 · Rlx Tall 19]. W149-W151 (Aug-10 boxes) excluded as already loaded. Olive now fully shipped vs order; short 3× Rlx 36/36 Tall + 1× Rlx 34/32 Reg, offset by make-up units in other sizes." });
  const { data: after } = await sb.from("items").select("name, ship_qtys, received_qtys, ship_final, pipeline_stage").in("id", Array.from(lastTrackingByItem.keys()));
  console.log(`\nAFTER:`);
  for (const it of after || []) console.log(`  ${it.name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  const { data: boxes } = await sb.from("shipments").select("tracking, status, created_at, shipment_lines(description, ship_qtys)").in("tracking", trackings);
  console.log(`\nNEW INCOMING BOXES on /receiving2:`);
  for (const b of boxes || []) console.log(`  ${b.tracking} · ${b.status} · ship ${String(b.created_at).slice(0, 10)} · [${(b.shipment_lines || []).map((l) => `${l.description} ${sumMap(l.ship_qtys)}`).join(" + ")}]`);
  console.log();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
