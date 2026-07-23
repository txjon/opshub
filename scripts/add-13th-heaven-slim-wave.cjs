#!/usr/bin/env node
/**
 * 2026-07-22 (Jon's go): ADD the next 13th Heaven → FOG Ridgeline wave to
 * receiving. This wave is the SLIM-SHORT fit (order 26-FOG-XS16H/XS18H),
 * shipping in on TWO FedEx master waybills. NOT a final shipment — more waves
 * to come, so ship_final stays false.
 *
 *   Box A  874717609723  Crocodile only         (cartons W81+W82+W83) = 150
 *   Box B  874717496418  Crocodile W80 + Olive  (W80 / W77-W80)       = 32 + 191
 *
 * Contents verified carton-by-carton against the vendor packing-slip image;
 * every size reconciles to the slip's Pack-qty row (Croc 182 · Olive 191) and
 * every key exists as an ordered buy_sheet_line.
 *
 * ADD mode — creates two NEW boxes, never touches the already-received Relaxed
 * wave. Uses the real primitives (upsertShipmentForItem + recordShip +
 * recalcJobPhase) so the ledger/item/phase land exactly as a production2 ship.
 * One box per MASTER waybill (never child waybills) — that mixed master/child
 * split is what double-counted last time.
 *
 * Usage: npx -y tsx scripts/add-13th-heaven-slim-wave.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9"; // 13th Heaven LLC
const DECORATOR_NAME = "13th Heaven LLC";
const SHIP_DATE = "2026-07-22";

// items use "Slim / 28 / 30 (Short)" (fit / waist / inseam (length))
const S = (w) => `Slim / ${w} / 30 (Short)`;
const q = (m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [S(w), n]));
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);
const sumMap = (m) => Object.values(m || {}).reduce((a, n) => a + (Number(n) || 0), 0);

// per master waybill → per item → per-size (packing-slip Pack-qty, screenshot-verified)
const MASTERS = [
  { tracking: "874717609723", items: {
    "Crocodile Ridgeline Pant": q({ 28: 26, 32: 53, 34: 37, 36: 20, 38: 10, 40: 4 }), // 150  W81+W82+W83
  } },
  { tracking: "874717496418", items: {
    "Crocodile Ridgeline Pant": q({ 30: 30, 34: 2 }),                                  //  32  W80
    "Olive Ridgeline Pant":     q({ 28: 18, 30: 42, 32: 53, 34: 45, 36: 16, 38: 12, 40: 2, 42: 3 }), // 191  W77-W80
  } },
];
const WAVE_EXPECT = { "Crocodile Ridgeline Pant": 182, "Olive Ridgeline Pant": 191 };

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

  // 5) ABORT if a box already carries either master tracking (prevents double-apply)
  const trackings = MASTERS.map((m) => m.tracking);
  const { data: dup } = await sb.from("shipments").select("id, tracking").in("tracking", trackings);
  if ((dup || []).length) throw new Error(`box(es) already exist for ${dup.map((d) => d.tracking).join(", ")} — aborting (already applied?)`);

  // ---- report plan + before-state ----
  console.log(`job ${JOB_NUMBER} (phase=${job.phase})  ·  decorator ${dec.name}`);
  console.log(`\nBEFORE (this wave is additive — Relaxed stays put):`);
  for (const name of Object.keys(WAVE_EXPECT)) {
    const it = itemByName.get(name);
    console.log(`  ${name}: shipped ${sumMap(it.ship_qtys)} · received ${sumMap(it.received_qtys)} · ship_final=${it.ship_final} · stage=${it.pipeline_stage}`);
  }
  console.log(`\nPLANNED BOXES:`);
  for (const m of MASTERS) {
    console.log(`  ▸ Box ${m.tracking}  (FedEx, ship ${SHIP_DATE})`);
    for (const [name, qtys] of Object.entries(m.items)) {
      const parts = Object.entries(qtys).map(([k, v]) => `${k.match(/\/ (\d+) \//)[1]}=${v}`).join(" ");
      console.log(`      ${name.split(" ")[0].padEnd(10)} ${String(tot(qtys)).padStart(3)}  [${parts}]`);
    }
  }
  console.log(`\n  wave total: ${MASTERS.reduce((a, m) => a + Object.values(m.items).reduce((x, qs) => x + tot(qs), 0), 0)} pcs (Croc 182 · Olive 191)`);

  if (!APPLY) { console.log("\nDRY RUN — pass --apply to write.\n"); return; }

  // ---- apply: create boxes + ledger ship movements ----
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
  // (across ALL sizes). Far from closed here (Slim Regular/Long/Tall still owed),
  // so ship_final stays false and the item stays in_production — as intended.
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
  await sb.from("job_activity").insert({ job_id: job.id, message: "Added 13th Heaven Slim-Short wave to receiving — 2 FedEx master boxes (609723 · 496418), 373 pcs [Crocodile 182 · Olive 191]. More waves to come." });

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
