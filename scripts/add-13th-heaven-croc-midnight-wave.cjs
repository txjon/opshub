#!/usr/bin/env node
/**
 * 2026-08-01 (Jon's slips): ADD the next 13th Heaven → FOG Ridgeline wave.
 * CROCODILE (first Croc wave since June) + MIDNIGHT top-up. THREE FedEx
 * master waybills, ship dates 7/31-8/1:
 *
 *   Box 875139743391  (ship 7/31, cartons W108-W111) = 206
 *     Crocodile Relaxed Extra-Long (x/36): 32:8 34:25            =  33 (W111)
 *     Midnight  Relaxed Long (x/34): 32:29                        =  29 (W111+W110)
 *     Midnight  Slim Extra-Long (x/36): 32:2 34:6 36:3 38:5       =  16 (W110)
 *     Midnight  Slim Regular (x/32): 28:10 32:55 34:39 36:24      = 128 (W108-W110)
 *   (children 875139743428/875139743406/875139743417; W111 rides the master)
 *
 *   Box 875187356245  (ship 8/1, cartons W116-W119) = 212
 *     Crocodile Relaxed Regular (x/32): 28:8 30:47 32:19 34:132   = 206
 *     Midnight  Relaxed Regular (x/32): 30:6                      =   6 (W119)
 *   (children 875187356267/875187356278/875187356256; W117 rides the master)
 *
 *   Box 875187270717  (ship 8/1, cartons W112-W115) = 197
 *     Crocodile Relaxed Regular (x/32): 34:24 36:82 38:30 40:11 42:10 = 157
 *     Crocodile Relaxed Extra-Long (x/36): 32:3 36:18 38:13 40:6      =  40 (W112)
 *   (children 875187270739/875187270740/875187270728; W113 rides the master)
 *
 * EXCLUDED (slip repeats of already-loaded cartons): W95/W97-W99 (Jul-28
 * masters 874970656482 / 874971898610) and W100-W104, W107 (Jul-29 masters
 * 875028878528 / 875029200130). Every section's Pack row reconciles: new
 * cartons = Pack − previously loaded (e.g. Midnight Slim Reg 180−52=128,
 * Midnight Rlx Reg 296−290=6, Croc Rlx XL 73 = 33+40). Samples (1件样品 ×3)
 * never load. Several sizes +1 over order (13H make-up units — amber, correct).
 *
 * Wave: Crocodile 436 (RR 363 · XL 73) + Midnight 179 = 615. Both items stay
 * OPEN (Croc 854/1517 · Midnight 929/952) — ship_final false.
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-croc-midnight-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9"; // 13th Heaven LLC
const DECORATOR_NAME = "13th Heaven LLC";
const CHILD_WAYBILLS = [
  "875139743428", "875139743406", "875139743417",   // children of ...743391
  "875187356267", "875187356278", "875187356256",   // children of ...356245
  "875187270739", "875187270740", "875187270728",   // children of ...270717
];

const CROC = "Crocodile Ridgeline Pant";
const MID = "Midnight Ridgeline Pant";
const RT = (w) => `Relaxed / ${w} / 36 (Tall)`;    // "Extra-Long" on 13H slips
const RL = (w) => `Relaxed / ${w} / 34 (Long)`;
const RR = (w) => `Relaxed / ${w} / 32 (Regular)`;
const ST = (w) => `Slim / ${w} / 36 (Tall)`;
const SR = (w) => `Slim / ${w} / 32 (Regular)`;
const q = (fn, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fn(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

const MASTERS = [
  { tracking: "875139743391", shipDate: "2026-07-31", items: {
      [CROC]: { ...q(RT, { 32: 8, 34: 25 }) },                                    //  33
      [MID]: {
        ...q(RL, { 32: 29 }),                                                     //  29
        ...q(ST, { 32: 2, 34: 6, 36: 3, 38: 5 }),                                 //  16
        ...q(SR, { 28: 10, 32: 55, 34: 39, 36: 24 }),                             // 128
      },
  } },
  { tracking: "875187356245", shipDate: "2026-08-01", items: {
      [CROC]: { ...q(RR, { 28: 8, 30: 47, 32: 19, 34: 132 }) },                   // 206
      [MID]: { ...q(RR, { 30: 6 }) },                                             //   6
  } },
  { tracking: "875187270717", shipDate: "2026-08-01", items: {
      [CROC]: {
        ...q(RR, { 34: 24, 36: 82, 38: 30, 40: 11, 42: 10 }),                     // 157
        ...q(RT, { 32: 3, 36: 18, 38: 13, 40: 6 }),                               //  40
      },
  } },
];
const WAVE_EXPECT = { [CROC]: 436, [MID]: 179 };

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
    console.log(`  ▸ Box ${m.tracking}  (FedEx, ship ${m.shipDate})`);
    for (const [name, qtys] of Object.entries(m.items)) {
      for (const [k, v] of Object.entries(qtys)) console.log(`      ${name.split(" ")[0].padEnd(10)} ${k.padEnd(28)} ${v}`);
      console.log(`      ${name.split(" ")[0].padEnd(10)} = ${tot(qtys)} pcs`);
    }
  }
  console.log(`\n  wave total: ${MASTERS.reduce((a, m) => a + Object.values(m.items).reduce((x, qs) => x + tot(qs), 0), 0)} pcs (Croc 436 · Midnight 179)`);

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
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added 13th Heaven Croc+Midnight wave to receiving — 3 FedEx master boxes (743391 W108-W111 = 206, 356245 W116-W119 = 212, 270717 W112-W115 = 197), 615 pcs [Croc 436 · Midnight 179]. Slip repeats of Jul-28/29 cartons excluded. More waves to come." });

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
