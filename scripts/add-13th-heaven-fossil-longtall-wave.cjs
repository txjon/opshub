#!/usr/bin/env node
/**
 * 2026-07-27 (Jon's go): ADD the next 13th Heaven → FOG Ridgeline wave to
 * receiving. This wave is FOSSIL RELAXED, Long + Extra-Long inseams (order
 * 26-FOG-KS21H), ONE FedEx master waybill:
 *
 *   Box 874905728506  Fossil only, cartons W88-W91 = 196
 *     Long (x/34):  W89(25) + W90(50) + W91(50) = 125
 *     Tall (x/36):  W88(48) + W89(23)           =  71
 *   (child waybills 874905728539 / 874905728528 / 874905728507 fold into the
 *    master; W88 rides the master number itself)
 *
 * Contents verified carton-by-carton against the vendor packing slip; every
 * size reconciles to the slip's Pack-qty row (Long 125 · Tall 71) and the
 * slip's Order-qty row matches OpsHub buy_sheet_lines size-for-size. Five
 * Tall sizes ship +1 over order (vendor overrun — will show the amber
 * over-shipped flag, correctly). The Long "Less" −46 stays OWED (more waves
 * coming) — ship_final stays false.
 *
 * ADD mode — creates ONE new box, never touches received waves. Uses the real
 * primitives (upsertShipmentForItem + recordShip + recalcJobPhase) so the
 * ledger/item/phase land exactly as a production2 ship. One box per MASTER
 * waybill (never child waybills) — the mixed master/child split is what
 * double-counted the first Ridgeline wave.
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-fossil-longtall-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9"; // 13th Heaven LLC
const DECORATOR_NAME = "13th Heaven LLC";
const SHIP_DATE = "2026-07-27";
const CHILD_WAYBILLS = ["874905728539", "874905728528", "874905728507"]; // must never become boxes

// items use "Relaxed / 34 / 34 (Long)" (fit / waist / inseam (length))
const L = (w) => `Relaxed / ${w} / 34 (Long)`;
const T = (w) => `Relaxed / ${w} / 36 (Tall)`;
const q = (fn, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fn(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// per master waybill → per item → per-size (packing-slip Pack-qty, screenshot-verified)
const MASTERS = [
  { tracking: "874905728506", items: {
    "Fossil Ridgeline Pant": {
      ...q(L, { 30: 7, 32: 24, 34: 63, 36: 31 }),          // 125  Long   W89+W90+W91
      ...q(T, { 32: 13, 34: 28, 36: 18, 38: 10, 40: 2 }),  //  71  Tall   W88+W89
    },
  } },
];
const WAVE_EXPECT = { "Fossil Ridgeline Pant": 196 };

async function main() {
  const handoff = await import("../lib/handoff.ts");
  const ledger = await import("../lib/inventory-ledger.ts");
  const { recalcJobPhase } = await import("../lib/job-phase-recalc.ts");
  const { ensureTracker } = await import("../lib/inbound-tracking.ts");

  const { data: job } = await sb.from("jobs").select("id, phase").eq("job_number", JOB_NUMBER).single();
  if (!job) throw new Error(`job ${JOB_NUMBER} not found`);
  const { data: items } = await sb.from("items").select("id, name, ship_qtys, received_qtys, ship_final, pipeline_stage").eq("job_id", job.id);
  const itemByName = new Map((items || []).map((i) => [i.name, i]));

  // 1) items exist
  for (const m of MASTERS) for (const name of Object.keys(m.items))
    if (!itemByName.has(name)) throw new Error(`item not found on job: ${name}`);

  // 2) decorator sanity
  const { data: dec } = await sb.from("decorators").select("id, name").eq("id", DECORATOR_ID).single();
  if (!dec || !/13th heaven/i.test(dec.name)) throw new Error(`decorator ${DECORATOR_ID} is not 13th Heaven (got ${dec?.name})`);

  // 3) per-item wave sums match expectation
  for (const [name, n] of Object.entries(WAVE_EXPECT)) {
    const got = MASTERS.reduce((a, m) => a + (m.items[name] ? tot(m.items[name]) : 0), 0);
    if (got !== n) throw new Error(`wave sum for ${name} = ${got}, expected ${n}`);
  }

  // 4) every size key exists as an ordered buy_sheet_line (else derivation breaks)
  for (const name of Object.keys(WAVE_EXPECT)) {
    const { data: bsl } = await sb.from("buy_sheet_lines").select("size").eq("item_id", itemByName.get(name).id);
    const ordered = new Set((bsl || []).map((l) => l.size));
    for (const m of MASTERS) for (const k of Object.keys(m.items[name] || {}))
      if (!ordered.has(k)) throw new Error(`no ordered buy_sheet_line for ${name} :: ${k}`);
  }

  // 5) ABORT if a box already carries the master OR any child waybill
  //    (prevents double-apply AND the master/child double-count)
  const trackings = MASTERS.map((m) => m.tracking);
  const { data: dup } = await sb.from("shipments").select("id, tracking").in("tracking", [...trackings, ...CHILD_WAYBILLS]);
  if ((dup || []).length) throw new Error(`box(es) already exist for ${dup.map((d) => d.tracking).join(", ")} — aborting (already applied?)`);

  // ---- report plan + before-state ----
  console.log(`job ${JOB_NUMBER} (phase=${job.phase})  ·  decorator ${dec.name}`);
  console.log(`\nBEFORE (this wave is additive — received waves stay put):`);
  for (const name of Object.keys(WAVE_EXPECT)) {
    const it = itemByName.get(name);
    console.log(`  ${name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  }
  console.log(`\nPLANNED BOXES:`);
  for (const m of MASTERS) {
    console.log(`  ▸ Box ${m.tracking}  (FedEx, ship ${SHIP_DATE})`);
    for (const [name, qtys] of Object.entries(m.items)) {
      const parts = Object.entries(qtys).map(([k, v]) => `${k.replace("Relaxed / ", "").replace(" (Long)", "L").replace(" (Tall)", "T")}=${v}`).join(" ");
      console.log(`      ${name.split(" ")[0].padEnd(10)} ${String(tot(qtys)).padStart(3)}  [${parts}]`);
    }
  }
  console.log(`\n  wave total: ${MASTERS.reduce((a, m) => a + Object.values(m.items).reduce((x, qs) => x + tot(qs), 0), 0)} pcs (Long 125 · Tall 71)`);

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write.\n"); return; }

  // ---- apply: create box + ledger ship movements ----
  const shipDateIso = `${SHIP_DATE}T12:00:00Z`; // midday UTC = same calendar day in Vegas
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

  // item state — mirror shipFromProduction pass 2. closed = shipped>=ordered
  // (across ALL sizes). Far from closed here (all Slims + 46 Relaxed Longs
  // still owed), so ship_final stays false and the item stays in_production.
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

  // live carrier tracking — best-effort, never fatal
  for (const b of boxIds) {
    try { const r = await ensureTracker(sb, b.id); console.log(`  tracker ${b.tracking}: ${r?.created ? "created" : (r?.reason || "skipped")}`); }
    catch (e) { console.log(`  tracker ${b.tracking}: skipped (${e.message})`); }
  }

  await recalcJobPhase(sb, job.id);
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added 13th Heaven Fossil Long/Tall wave to receiving — 1 FedEx master box (728506, cartons W88-W91), 196 pcs [Long 125 · Tall 71]. More waves to come." });

  // ---- after-state ----
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
main().catch((e) => { console.error("ABORT:", e.message); process.exit(1); });
