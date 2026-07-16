#!/usr/bin/env node
/**
 * One-off backfill (2026-07-15): recreate inbound shipment boxes for the 3 FOG
 * items that shipped under the LEGACY flow (ledger has a ship movement, but no
 * shipments/shipment_lines row existed pre-migration-117), so they surface on
 * /receiving2 Incoming and can be counted in through the normal receive modal.
 *
 * Scope-locked to the 3 item ids below (Jon: "just the 3 fog items").
 * Safe to re-run: skips any item that already has a shipment_lines row.
 *
 * Usage:
 *   node scripts/backfill-v2-limbo-boxes.cjs          # dry run (prints rows)
 *   node scripts/backfill-v2-limbo-boxes.cjs --apply  # insert
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const HPD_COMPANY_ID = "4f9db6bd-bdd0-44cc-aa5c-5d67cd0b37bd";

// item_id → box config; ship_qtys are read from the item's ledger ship movement
// at run time and cross-checked against these expected totals.
const TARGETS = [
  {
    itemId: "89e307e9-a82c-4bdd-bdb2-32cc1e5556a8", // Brown Belt · HPD-2604-043
    decoratorId: "7c8a8725-8784-4d15-9a31-552515b8abb1", // Scorpion Strategic LLC
    carrier: "Freight", pickup: false, expectTotal: 2400,
  },
  {
    itemId: "cd3cffc2-184c-48e9-baf3-88d3964705de", // Real Tree Mesh Gym Shorts · HPD-2604-008
    decoratorId: "e684a23e-6d28-4bb8-8e9c-066cfc2a9599", // Battle Maple
    carrier: "Ocean Freight", pickup: false, expectTotal: 3500,
  },
  {
    itemId: "4c7a9249-50c0-4f49-8f3e-268f29f208f5", // Grupo Tee · HPD-2606-040
    decoratorId: "8bf64fd1-c309-46ae-9114-2f43983eb60f", // Teeland - Screen Printing
    carrier: null, pickup: true, expectTotal: 3721, // legacy tracking was "Pick Up"
  },
];

const sum = q => Object.values(q || {}).reduce((a, n) => a + (Number(n) || 0), 0);
const day = iso => (iso || "").slice(0, 10);

(async () => {
  for (const t of TARGETS) {
    const { data: item, error: ie } = await sb.from("items")
      .select("id, job_id, name, shipping_route, jobs(job_number, shipping_route, phase)")
      .eq("id", t.itemId).single();
    if (ie || !item) { console.error(`ABORT — item ${t.itemId} not found:`, ie?.message); process.exit(1); }

    // guards: still receiving-bound, no existing box line, no receive movements
    const route = item.shipping_route || item.jobs?.shipping_route;
    if (route === "drop_ship") { console.error(`ABORT — ${item.name} is drop_ship`); process.exit(1); }
    const { data: existLine } = await sb.from("shipment_lines").select("id").eq("item_id", t.itemId);
    if (existLine?.length) { console.log(`SKIP ${item.name} — already has ${existLine.length} shipment line(s).`); continue; }

    const { data: mvs } = await sb.from("movements").select("type, qtys, created_at")
      .eq("item_id", t.itemId).in("type", ["ship", "receive"]).order("created_at");
    const ships = mvs.filter(m => m.type === "ship");
    const recvs = mvs.filter(m => m.type === "receive");
    if (ships.length !== 1 || recvs.length !== 0) {
      console.error(`ABORT — ${item.name}: expected exactly 1 ship + 0 receive movements, found ${ships.length}/${recvs.length}`); process.exit(1);
    }
    const shipQtys = ships[0].qtys;
    if (sum(shipQtys) !== t.expectTotal) {
      console.error(`ABORT — ${item.name}: ledger total ${sum(shipQtys)} != expected ${t.expectTotal}`); process.exit(1);
    }

    const groupKey = `backfill:v2-cutover:${t.itemId}`;
    const { data: existKey } = await sb.from("shipments").select("id").eq("group_key", groupKey);
    if (existKey?.length) { console.log(`SKIP ${item.name} — backfill shipment already exists.`); continue; }

    const shipmentRow = {
      company_id: HPD_COMPANY_ID,
      direction: "inbound",
      source: "decorator",
      decorator_id: t.decoratorId,
      group_key: groupKey,
      carrier: t.carrier,
      tracking: null,
      pickup: t.pickup,
      expected_arrival: null,
      status: "expected",
      warehouse_notes: `Backfilled box — item shipped under the legacy flow on ${day(ships[0].created_at)}; recreated after the v2 cutover so it can be received here.`,
      created_by: null,
    };
    const lineRow = {
      item_id: t.itemId,
      job_id: item.job_id,
      description: item.name,
      ship_qtys: shipQtys,
    };
    console.log(`\n=== ${item.jobs.job_number} · ${item.name} (route=${route}, job phase=${item.jobs.phase}) ===`);
    console.log("shipment:", JSON.stringify(shipmentRow));
    console.log("line:    ", JSON.stringify(lineRow), `(${sum(shipQtys)} units)`);

    if (!APPLY) { console.log("(dry run — not inserted)"); continue; }

    const { data: created, error: se } = await sb.from("shipments").insert(shipmentRow).select("id").single();
    if (se) { console.error(`ABORT — shipment insert failed for ${item.name}:`, se.message); process.exit(1); }
    const { error: le } = await sb.from("shipment_lines").insert({ ...lineRow, shipment_id: created.id });
    if (le) {
      console.error(`ERROR — line insert failed for ${item.name}: ${le.message}. Rolling back shipment ${created.id}.`);
      await sb.from("shipments").delete().eq("id", created.id);
      process.exit(1);
    }
    console.log(`INSERTED shipment ${created.id} + 1 line.`);
  }
  console.log(APPLY ? "\nDone." : "\nDry run complete — re-run with --apply to insert.");
})().catch(e => { console.error(e); process.exit(1); });
