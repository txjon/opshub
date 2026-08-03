#!/usr/bin/env node
/**
 * 2026-08-03 (Jon's slip): ADD the next 13th Heaven → FOG Ridgeline wave.
 * CROCODILE only, ONE FedEx master waybill, ship 8/3:
 *
 *   Box 875222259225  (cartons W120-W123) = 209
 *     Relaxed Long (x/34): 30:14 32:56 34:4 38:19 40:4 42:4    = 101 (W122+W123)
 *     Relaxed Regular (x/32): 32:108                            = 108 (W120+W121)
 *   (children 875222259236/875222259247/875222259258; W123 rides the master)
 *
 * EXCLUDED (slip repeats): W112-W119 = the Aug-1 wave (masters 875187356245 /
 * 875187270717). Pack rows reconcile: RR 471 − 363 loaded = 108 new; Long 101
 * all new. Sample (1件样品) never loads. Several Long sizes +1/+3 over order
 * (13H make-up units — amber, correct). Croc stays OPEN (1063/1517).
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-croc-aug3-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9";
const DECORATOR_NAME = "13th Heaven LLC";
const CHILD_WAYBILLS = ["875222259236", "875222259247", "875222259258"];

const CROC = "Crocodile Ridgeline Pant";
const RL = (w) => `Relaxed / ${w} / 34 (Long)`;
const RR = (w) => `Relaxed / ${w} / 32 (Regular)`;
const q = (fn, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fn(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const MASTERS = [
  { tracking: "875222259225", shipDate: "2026-08-03", items: {
      [CROC]: {
        ...q(RL, { 30: 14, 32: 56, 34: 4, 38: 19, 40: 4, 42: 4 }),   // 101
        ...q(RR, { 32: 108 }),                                       // 108
      },
  } },
];
const WAVE_EXPECT = { [CROC]: 209 };

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
  const { data: dup } = await sb.from("shipments").select("id, tracking").in("tracking", [...trackings, ...CHILD_WAYBILLS]);
  if ((dup || []).length) throw new Error(`box(es) already exist for ${dup.map((d) => d.tracking).join(", ")} — aborting`);

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
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added 13th Heaven Crocodile wave to receiving — 1 FedEx master box (259225, cartons W120-W123), 209 pcs [Rlx Long 101 · Rlx Reg 108]. Slip repeats of Aug-1 cartons W112-W119 excluded. More waves to come." });
  const { data: after } = await sb.from("items").select("name, ship_qtys, received_qtys, ship_final, pipeline_stage").in("id", Array.from(lastTrackingByItem.keys()));
  console.log(`\nAFTER:`);
  for (const it of after || []) console.log(`  ${it.name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  const { data: boxes } = await sb.from("shipments").select("tracking, status, created_at, shipment_lines(description, ship_qtys)").in("tracking", trackings);
  console.log(`\nNEW INCOMING BOX on /receiving2:`);
  for (const b of boxes || []) console.log(`  ${b.tracking} · ${b.status} · ship ${String(b.created_at).slice(0, 10)} · [${(b.shipment_lines || []).map((l) => `${l.description} ${sumMap(l.ship_qtys)}`).join(" + ")}]`);
  console.log();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
