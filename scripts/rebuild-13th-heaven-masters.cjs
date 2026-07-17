#!/usr/bin/env node
/**
 * One-off (2026-07-16, Jon's go): rebuild the 13th Heaven → FOG Ridgeline
 * Pants shipment (HPD-2606-040) as SEVEN boxes — one per FedEx master
 * waybill — replacing one catch-all box ("MULTIPLE - SEE ATTACHMENT") and
 * five hollow pre-fix boxes (mixed master/child waybills, no lines).
 *
 * Contents per master come from the vendor manifest
 * (FOG_Receiving_Cartons_W45-W72.xlsx), verified carton-by-carton against
 * the vendor's original screenshots — 28 cartons, 1,435 pcs.
 *
 * Uses the real ship primitives (upsertShipmentForItem + recordShip +
 * recalcJobPhase) so the ledger, item state, and phase land exactly as a
 * production2 ship would. Trackers registered per master.
 *
 * Usage: npx -y tsx scripts/rebuild-13th-heaven-masters.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const JOB_NUMBER = "HPD-2606-040";
const DECORATOR_ID = "f0794e00-a0dc-4c24-8cf1-6d4e69df1ec9"; // 13th Heaven LLC
const DOOMED_TRACKING = ["MULTIPLE - SEE ATTACHMENT", "874148899410", "874148899384", "874286874189", "874349357559", "874349855343"];

// size key builders — items use "Relaxed / 28 / 30 (Short)" / "Relaxed / 28 / 32 (Regular)"
const S = (w) => `Relaxed / ${w} / 30 (Short)`;
const R = (w) => `Relaxed / ${w} / 32 (Regular)`;
const q = (fit, m) => Object.fromEntries(Object.entries(m).map(([w, n]) => [fit(w), n]));

// Per master waybill: ship date + per-item per-size qtys (manifest Cartons tab,
// screenshot-verified). Item keys = exact item names on the job.
const MASTERS = [
  { tracking: "874148899384", date: "2026-07-09", items: {
    "Fossil Ridgeline Pant": q(S, { 28: 9, 30: 24, 32: 49, 34: 41, 36: 26, 38: 16, 40: 6, 42: 5 }),      // 176
    "Crocodile Ridgeline Pant": q(S, { 28: 9, 38: 22 }),                                                  // 31
  } },
  { tracking: "874286874167", date: "2026-07-13", items: {
    "Crocodile Ridgeline Pant": q(S, { 30: 30, 32: 66, 34: 55, 36: 38, 40: 8, 42: 4 }),                   // 201
    "Olive Ridgeline Pant": q(S, { 28: 12 }),                                                             // 12
  } },
  { tracking: "874349256593", date: "2026-07-14", items: {
    "Olive Ridgeline Pant": q(S, { 28: 1, 30: 28, 32: 54, 34: 56, 36: 39, 38: 17, 40: 8, 42: 6 }),        // 209
  } },
  { tracking: "874349357548", date: "2026-07-14", items: {
    "Olive Ridgeline Pant": { ...q(S, { 34: 7 }), ...q(R, { 28: 8, 30: 30, 32: 74, 36: 75, 42: 9 }) },    // 203
  } },
  { tracking: "874349855310", date: "2026-07-14", items: {
    "Olive Ridgeline Pant": q(R, { 30: 16, 32: 45, 34: 86, 38: 36, 40: 15 }),                             // 198
  } },
  { tracking: "874405841086", date: "2026-07-15", items: {
    "Olive Ridgeline Pant": q(R, { 34: 76 }),                                                             // 76
    "Fossil Ridgeline Pant": q(R, { 30: 32, 32: 100 }),                                                   // 132
  } },
  { tracking: "874405742929", date: "2026-07-15", items: {
    "Fossil Ridgeline Pant": q(R, { 28: 8, 30: 6, 34: 99, 36: 53, 38: 11, 40: 10, 42: 10 }),              // 197
  } },
];
const tot = (m) => Object.values(m).reduce((a, n) => a + n, 0);

async function main() {
  const handoff = await import("../lib/handoff.ts");
  const ledger = await import("../lib/inventory-ledger.ts");
  const { recalcJobPhase } = await import("../lib/job-phase-recalc.ts");
  const { ensureTracker, applyTrackerPayload } = await import("../lib/inbound-tracking.ts");

  const { data: job } = await sb.from("jobs").select("id").eq("job_number", JOB_NUMBER).single();
  const { data: items } = await sb.from("items").select("id, name").eq("job_id", job.id);
  const itemByName = new Map(items.map((i) => [i.name, i]));
  for (const m of MASTERS) for (const name of Object.keys(m.items)) {
    if (!itemByName.has(name)) throw new Error(`item not found on job: ${name}`);
  }

  // sanity: manifest totals must match saved items.ship_qtys totals
  const expect = { "Fossil Ridgeline Pant": 505, "Crocodile Ridgeline Pant": 232, "Olive Ridgeline Pant": 698 };
  for (const [name, n] of Object.entries(expect)) {
    const got = MASTERS.reduce((a, m) => a + (m.items[name] ? tot(m.items[name]) : 0), 0);
    if (got !== n) throw new Error(`per-master sums for ${name} = ${got}, expected ${n}`);
  }
  console.log("manifest sums verified: Fossil 505 · Crocodile 232 · Olive 698 = 1,435");

  // the doomed boxes — verify shape before deleting
  const { data: doomed } = await sb.from("shipments")
    .select("id, tracking, status, easypost_tracker_id, shipment_lines(id, received)")
    .eq("decorator_id", DECORATOR_ID).eq("direction", "inbound").in("tracking", DOOMED_TRACKING);
  let keepTracker = null; // reuse the delivered master-1 tracker on the new box
  for (const b of doomed || []) {
    const recvd = (b.shipment_lines || []).filter((l) => l.received).length;
    if (b.status === "received" || recvd > 0) throw new Error(`box ${b.tracking} has received data — aborting, nothing touched`);
    if (b.tracking === "874148899384" && b.easypost_tracker_id) keepTracker = b.easypost_tracker_id;
    console.log(`will delete: ${b.tracking} (${(b.shipment_lines || []).length} lines, ${b.status})`);
  }
  if ((doomed || []).length !== 6) throw new Error(`expected 6 boxes to delete, found ${(doomed || []).length} — aborting`);

  if (!APPLY) { console.log("\nDry run — --apply to execute."); return; }

  for (const b of doomed) {
    await sb.from("tracking_events").delete().eq("shipment_id", b.id);
    await sb.from("shipment_lines").delete().eq("shipment_id", b.id);
    await sb.from("shipments").delete().eq("id", b.id);
  }
  console.log("deleted 6 boxes");

  const shipDateIso = (d) => `${d}T12:00:00Z`; // midday UTC = same calendar day in Vegas
  const lastTrackingByItem = new Map();
  const boxIds = [];
  for (const m of MASTERS) {
    let boxId = null;
    for (const [name, qtys] of Object.entries(m.items)) {
      const it = itemByName.get(name);
      boxId = await handoff.upsertShipmentForItem(sb, {
        job_id: job.id, item_id: it.id, item_name: name,
        decorator_id: DECORATOR_ID, decorator_name: "13th Heaven LLC",
        pickup_ready: false, ship_tracking: m.tracking, ship_date: shipDateIso(m.date),
        ship_qtys: qtys, carrier: "FedEx",
      });
      if (!boxId) throw new Error(`box create failed for ${m.tracking}`);
      await ledger.recordShip(sb, { itemId: it.id, jobId: job.id, waveQtys: qtys, shipmentId: boxId, tracking: m.tracking, description: name });
      lastTrackingByItem.set(it.id, m.tracking);
    }
    await sb.from("shipments").update({ created_at: shipDateIso(m.date) }).eq("id", boxId);
    boxIds.push({ id: boxId, tracking: m.tracking });
    console.log(`shipped ${m.tracking} (${m.date}) — ${Object.entries(m.items).map(([n, qs]) => `${n.split(" ")[0]} ${tot(qs)}`).join(" + ")}`);
  }

  // item state, mirroring shipFromProduction pass 2 (closed = fully shipped;
  // Fossil stays open — 33 pcs genuinely owed per the manifest)
  for (const [itemId, tracking] of Array.from(lastTrackingByItem.entries())) {
    const { data: st } = await sb.from("items").select("name, ship_qtys, pipeline_timestamps, buy_sheet_lines(qty_ordered), decorator_assignments(id)").eq("id", itemId).single();
    const shipped = tot(st.ship_qtys || {});
    const ordered = (st.buy_sheet_lines || []).reduce((a, b) => a + (Number(b.qty_ordered) || 0), 0);
    const closed = ordered > 0 && shipped >= ordered;
    const timestamps = { ...(st.pipeline_timestamps || {}), shipped: (st.pipeline_timestamps || {}).shipped || new Date().toISOString() };
    await sb.from("items").update({
      ship_final: closed, pipeline_stage: closed ? "shipped" : "in_production",
      ship_tracking: tracking, pipeline_timestamps: timestamps,
    }).eq("id", itemId);
    const daId = st.decorator_assignments?.[0]?.id;
    if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: closed ? "shipped" : "in_production", tracking_number: tracking }).eq("id", daId);
    console.log(`item ${st.name}: shipped ${shipped}/${ordered} → ${closed ? "closed (shipped)" : "open (more owed)"}`);
  }

  // trackers: reuse the delivered master-1 tracker; create the other six
  for (const b of boxIds) {
    if (b.tracking === "874148899384" && keepTracker) {
      const key = process.env.EASYPOST_API_KEY || "";
      const res = await fetch(`https://api.easypost.com/v2/trackers/${keepTracker}`, { headers: { Authorization: "Basic " + Buffer.from(key + ":").toString("base64") } });
      const trk = await res.json();
      if (res.ok) {
        await sb.from("shipments").update({ easypost_tracker_id: keepTracker, tracker_attempted_at: new Date().toISOString() }).eq("id", b.id);
        await applyTrackerPayload(sb, b.id, trk);
        console.log(`tracker reused for ${b.tracking} (${trk.status})`);
        continue;
      }
    }
    const r = await ensureTracker(sb, b.id);
    console.log(`tracker ${b.tracking}: ${r.created ? "created" : r.reason}`);
  }

  await recalcJobPhase(sb, job.id);
  await sb.from("job_activity").insert({ job_id: job.id, message: "Rebuilt 13th Heaven shipment as 7 FedEx master-waybill boxes from the vendor manifest (28 cartons, 1,435 pcs)" });

  const { data: after } = await sb.from("shipments")
    .select("tracking, created_at, carrier_status, est_delivery_date, delivered_at, shipment_lines(description, ship_qtys)")
    .eq("decorator_id", DECORATOR_ID).eq("direction", "inbound").neq("status", "received").order("created_at");
  console.log("\nfinal state — open 13th Heaven boxes:");
  for (const b of after || []) {
    const lines = (b.shipment_lines || []).map((l) => `${l.description} ${tot(l.ship_qtys || {})}`).join(" + ");
    console.log(`  ${b.tracking} · shipped ${String(b.created_at).slice(0, 10)} · ${b.carrier_status || "no feed yet"} · est ${b.est_delivery_date || "-"} · delivered ${b.delivered_at ? String(b.delivered_at).slice(0, 10) : "-"} · [${lines}]`);
  }
}
main().catch((e) => { console.error("ABORT:", e.message); process.exit(1); });
