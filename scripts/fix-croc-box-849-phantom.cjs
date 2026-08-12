#!/usr/bin/env node
/**
 * 2026-08-11: Correct Croc box 875403350849 (delivered 8/10, never received in
 * OpsHub). Jon confirmed everything delivered as of 8/10 was physically counted
 * into Shopify. Shopify keyed totals for Croc Rlx Longs = 56 (32/34, 10:20am)
 * + 87 (34/34, 2:08pm) = 143 = OpsHub-received 123 + 20. So this box physically
 * contained 20x Rlx 34/34 — the manifest's 49 (20x 32/34 + 29x 34/34) was
 * overstated by 29. Fix: ship correction -20 32/34 / -9 34/34, receive + stage
 * the 20, mark box received. Croc Longs then: shipped 32/34=56 (+3 vs 53
 * ordered), 34/34=87 (+1 vs 86) — back inside 13H's normal make-up pattern.
 *
 * Usage: npx -y tsx scripts/fix-croc-box-849-phantom.cjs
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const TRACKING = "875403350849";
const K32 = "Relaxed / 32 / 34 (Long)", K34 = "Relaxed / 34 / 34 (Long)";

(async () => {
  const ledger = await import("../lib/inventory-ledger.ts");
  const { data: job } = await sb.from("jobs").select("id").eq("job_number", "HPD-2606-040").single();
  const { data: it } = await sb.from("items").select("id,name").eq("job_id", job.id).eq("name", "Crocodile Ridgeline Pant").single();
  const { data: box } = await sb.from("shipments").select("id,status,carrier_status").eq("tracking", TRACKING).single();
  if (!box || box.status !== "expected" || box.carrier_status !== "delivered") throw new Error("box state unexpected: " + JSON.stringify(box));
  const { data: mv } = await sb.from("movements").select("type,qtys").eq("shipment_id", box.id);
  const ship = {}; let rec = 0;
  for (const m of mv) { if (m.type === "ship") for (const [s, n] of Object.entries(m.qtys)) ship[s] = (ship[s] || 0) + n; if (m.type === "receive") rec++; }
  if (rec) throw new Error("box already has receive movements — aborting");
  if (ship[K32] !== 20 || ship[K34] !== 29) throw new Error("ship qtys not as expected: " + JSON.stringify(ship));

  await ledger.appendMovement(sb, { itemId: it.id, jobId: job.id, type: "ship", qtys: { [K32]: -20, [K34]: -9 }, shipmentId: box.id, tracking: TRACKING,
    reason: "Corrected shipped count", description: "Physical 8/10 count: box contained 20x Rlx 34/34; manifest overstated by 29 (Shopify keyed totals 56+87 confirm)" });
  await ledger.appendMovement(sb, { itemId: it.id, jobId: job.id, type: "receive", qtys: { [K34]: 20 }, shipmentId: box.id, tracking: TRACKING,
    description: "Crocodile Ridgeline Pant — counted 2026-08-10, keyed directly into Shopify" });
  await ledger.appendMovement(sb, { itemId: it.id, jobId: job.id, type: "stage", qtys: { [K34]: 20 }, shipmentId: box.id,
    reason: "Entered into Shopify 2026-08-10 (within Jon's +87 manual adjustment)" });
  await sb.from("shipments").update({ status: "received", received_at: "2026-08-10T21:08:00Z" }).eq("id", box.id);
  await sb.from("shipment_lines").update({ ship_qtys: { [K34]: 20 }, received_qtys: { [K34]: 20 }, received: true }).eq("shipment_id", box.id).eq("item_id", it.id);
  await ledger.recomputeItemFromLedger(sb, it.id);
  await sb.from("job_activity").insert({ job_id: job.id, message: "Corrected Croc box 875403350849: manifest said 49 (20x Rlx 32/34 + 29x 34/34) but physical 8/10 count = 20x Rlx 34/34, already keyed into Shopify. Box marked received; 29 phantom units reversed. Receiving board now = in-transit boxes only." });
  const { data: after } = await sb.from("items").select("ship_qtys,received_qtys").eq("id", it.id).single();
  const sum = (m) => Object.values(m || {}).reduce((a, n) => a + (+n || 0), 0);
  console.log("Croc after: shipped " + sum(after.ship_qtys) + " (32/34=" + after.ship_qtys[K32] + ", 34/34=" + after.ship_qtys[K34] + ") · received " + sum(after.received_qtys) + " (34/34=" + after.received_qtys[K34] + ")");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
