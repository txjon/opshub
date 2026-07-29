#!/usr/bin/env node
/**
 * 2026-07-29 (Jon's slips): ADD the next 13th Heaven → FOG Ridgeline wave.
 * This wave is ALL MIDNIGHT (orders 26-FOG-XS22H slim / 26-FOG-KS23H relaxed),
 * TWO FedEx master waybills, ship date 2026/7/29:
 *
 *   Box 875028878528  cartons W104-W107 = 211
 *     Slim Regular (x/32): 30:24 34:8 38:15 40:3 42:2            =  52  (W107)
 *     Slim Short   (x/30): 28:9 30:19 32:38 34:34 36:14 38:9 40:4 = 127 (W104-W106)
 *     Relaxed Long (x/34): 30:6 34:26                            =  32  (W104 — mixed carton)
 *   (child waybills 875028878539/875028878540/875028878550 fold into the
 *    master; W105 rides the master number itself)
 *
 *   Box 875029200130  cartons W100-W103 = 191
 *     Relaxed Long    (x/34): 28:2 34:27 36:28 38:11 40:6        =  74  (W102+W103)
 *     Relaxed Regular (x/32): 34:20 36:50 38:27 40:8 42:12       = 117  (W100-W102)
 *   (child waybills 875029200141/875029200152/875029200163; W103 rides the master)
 *
 * EXCLUDED (already loaded Jul-28 — the slip repeats them): cartons W95
 * (master 874970656482) and W97/W98/W99 (master 874971898610) = 173 Relaxed
 * Regulars. The slip's Relaxed-Regular Pack 290 − 173 = 117 loaded here.
 * "1件样品" sample pieces are never loaded as inventory.
 *
 * Reconciles: Slim pack rows 52+127 ✓ · Relaxed Long pack 106 = 32+74 ✓ ·
 * several sizes ship +1 over order (13H make-up units — amber flags, correct).
 * Midnight stays OPEN after this (shipped 750 of 952) — ship_final false.
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-midnight-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9"; // 13th Heaven LLC
const DECORATOR_NAME = "13th Heaven LLC";
const SHIP_DATE = "2026-07-29";
const CHILD_WAYBILLS = [
  "875028878539", "875028878540", "875028878550",   // children of ...878528
  "875029200141", "875029200152", "875029200163",   // children of ...200130
];

const ITEM = "Midnight Ridgeline Pant";
const SR = (w) => `Slim / ${w} / 32 (Regular)`;
const SS = (w) => `Slim / ${w} / 30 (Short)`;
const RL = (w) => `Relaxed / ${w} / 34 (Long)`;
const RR = (w) => `Relaxed / ${w} / 32 (Regular)`;
const q = (fn, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fn(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const MASTERS = [
  { tracking: "875028878528", items: { [ITEM]: {
      ...q(SR, { 30: 24, 34: 8, 38: 15, 40: 3, 42: 2 }),                     //  52 Slim Regular
      ...q(SS, { 28: 9, 30: 19, 32: 38, 34: 34, 36: 14, 38: 9, 40: 4 }),     // 127 Slim Short
      ...q(RL, { 30: 6, 34: 26 }),                                           //  32 Relaxed Long (W104)
  } } },
  { tracking: "875029200130", items: { [ITEM]: {
      ...q(RL, { 28: 2, 34: 27, 36: 28, 38: 11, 40: 6 }),                    //  74 Relaxed Long
      ...q(RR, { 34: 20, 36: 50, 38: 27, 40: 8, 42: 12 }),                   // 117 Relaxed Regular
  } } },
];
const WAVE_EXPECT = { [ITEM]: 402 };

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
  if (!dec || !/13th heaven/i.test(dec.name)) throw new Error(`decorator ${DECORATOR_ID} is not 13th Heaven (got ${dec?.name})`);

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
  if ((dup || []).length) throw new Error(`box(es) already exist for ${dup.map((d) => d.tracking).join(", ")} — aborting (already applied?)`);

  console.log(`job ${JOB_NUMBER} (phase=${job.phase})  ·  decorator ${dec.name}`);
  console.log(`\nBEFORE (additive — received waves stay put):`);
  for (const name of Object.keys(WAVE_EXPECT)) {
    const it = itemByName.get(name);
    console.log(`  ${name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  }
  console.log(`\nPLANNED BOXES:`);
  for (const m of MASTERS) {
    console.log(`  ▸ Box ${m.tracking}  (FedEx, ship ${SHIP_DATE})`);
    for (const [name, qtys] of Object.entries(m.items)) {
      for (const [k, v] of Object.entries(qtys)) console.log(`      ${k.padEnd(30)} ${v}`);
      console.log(`      = ${tot(qtys)} pcs`);
    }
  }
  console.log(`\n  wave total: ${MASTERS.reduce((a, m) => a + Object.values(m.items).reduce((x, qs) => x + tot(qs), 0), 0)} pcs (Slim Reg 52 · Slim Short 127 · Rlx Long 106 · Rlx Reg 117)`);

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write.\n"); return; }

  const shipDateIso = `${SHIP_DATE}T12:00:00Z`;
  const lastTrackingByItem = new Map();
  const boxIds = [];
  console.log(`\napplying...`);
  for (const m of MASTERS) {
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
    await sb.from("items").update({
      ship_final: closed, pipeline_stage: closed ? "shipped" : "in_production",
      ship_tracking: tracking, pipeline_timestamps: timestamps,
    }).eq("id", itemId);
    const daId = st.decorator_assignments?.[0]?.id;
    if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: closed ? "shipped" : "in_production", tracking_number: tracking }).eq("id", daId);
    console.log(`  item ${st.name}: shipped ${shipped}/${ordered} → ${closed ? "closed" : "open (more owed)"}`);
  }

  for (const b of boxIds) {
    try { const r = await ensureTracker(sb, b.id); console.log(`  tracker ${b.tracking}: ${r?.created ? "created" : (r?.reason || "skipped")}`); }
    catch (e) { console.log(`  tracker ${b.tracking}: skipped (${e.message})`); }
  }

  await recalcJobPhase(sb, job.id);
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added 13th Heaven Midnight wave to receiving — 2 FedEx master boxes (878528 W104-W107 = 211, 200130 W100-W103 = 191), 402 pcs [Slim Reg 52 · Slim Short 127 · Rlx Long 106 · Rlx Reg 117]. Slip repeats of Jul-28 cartons W95/W97-W99 excluded. More waves to come." });

  const { data: after } = await sb.from("items").select("name, ship_qtys, received_qtys, ship_final, pipeline_stage").in("id", Array.from(lastTrackingByItem.keys()));
  console.log(`\nAFTER:`);
  for (const it of after || [])
    console.log(`  ${it.name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  const { data: boxes } = await sb.from("shipments").select("tracking, status, created_at, shipment_lines(description, ship_qtys)").in("tracking", trackings).order("created_at");
  console.log(`\nNEW INCOMING BOXES on /receiving2:`);
  for (const b of boxes || [])
    console.log(`  ${b.tracking} · ${b.status} · ship ${String(b.created_at).slice(0, 10)} · [${(b.shipment_lines || []).map((l) => `${l.description} ${sumMap(l.ship_qtys)}`).join(" + ")}]`);
  console.log();
}
main().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
