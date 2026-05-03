#!/usr/bin/env node
/**
 * Diagnose what /api/pdf/packing-slip would render for a given job, and
 * compare the three trigger paths:
 *   - Job detail "Documents" button       → no params (all items pass)
 *   - Client portal "Download packing"    → ?decoratorId=…&tracking=<item.ship_tracking>
 *   - Email after /shipping Mark Shipped  → ?tracking=<job.fulfillment_tracking>
 *
 * Usage:
 *   node scripts/diag-packing-slip.js INV-1234
 *   node scripts/diag-packing-slip.js HPD-2604-046
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-packing-slip.js <invoice# or job#>");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  let { data: jobs } = await sb
    .from("jobs")
    .select("id, title, job_number, type_meta, shipping_route, fulfillment_tracking, fulfillment_status, phase, clients(name)")
    .eq("job_number", arg);

  if (!jobs || jobs.length === 0) {
    const { data: all } = await sb
      .from("jobs")
      .select("id, title, job_number, type_meta, shipping_route, fulfillment_tracking, fulfillment_status, phase, clients(name)");
    jobs = (all || []).filter(j => (j.type_meta || {}).qb_invoice_number === arg);
  }
  if (!jobs || jobs.length === 0) {
    console.error(`No job matching "${arg}".`);
    process.exit(2);
  }

  for (const job of jobs) {
    const tm = job.type_meta || {};
    console.log("=".repeat(80));
    console.log(`Job: ${job.job_number}  Invoice: ${tm.qb_invoice_number || "—"}`);
    console.log(`Title: ${job.title}`);
    console.log(`Client: ${(job.clients || {}).name || "—"}`);
    console.log(`Route: ${job.shipping_route || "—"}`);
    console.log(`Phase: ${job.phase}    Fulfillment status: ${job.fulfillment_status || "—"}`);
    console.log(`Job fulfillment_tracking: ${job.fulfillment_tracking || "(empty)"}`);
    console.log("");

    const { data: items } = await sb
      .from("items")
      .select("id, name, blank_vendor, blank_sku, pipeline_stage, received_at_hpd, ship_tracking, ship_qtys, received_qtys, sample_qtys, sort_order, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", job.id)
      .order("sort_order");

    if (!items?.length) { console.log("  (no items)"); continue; }

    const isDropShip = (job.shipping_route || "ship_through") === "drop_ship";

    console.log(`Items (${items.length}):`);
    for (const it of items) {
      const lines = it.buy_sheet_lines || [];
      const r = it.received_qtys || {};
      const s = it.ship_qtys || {};
      const orderedQtys = Object.fromEntries(lines.map(l => [l.size, l.qty_ordered]));
      const firstChoice = isDropShip ? s : r;
      const secondChoice = isDropShip ? r : s;
      const delivered = {};
      for (const l of lines) {
        const a = firstChoice[l.size];
        const b = secondChoice[l.size];
        delivered[l.size] = (a !== undefined ? a : (b !== undefined ? b : orderedQtys[l.size])) ?? 0;
      }
      const samples = it.sample_qtys || {};
      const finalQtys = {};
      for (const [sz, q] of Object.entries(delivered)) finalQtys[sz] = Math.max(0, (q || 0) - (samples[sz] || 0));
      const total = Object.values(finalQtys).reduce((a, v) => a + v, 0);
      const sizesShown = Object.keys(finalQtys).filter(sz => (finalQtys[sz] || 0) > 0);

      console.log(`\n  [${String.fromCharCode(65 + (it.sort_order || 0))}] ${it.name}`);
      console.log(`      pipeline_stage:  ${it.pipeline_stage || "(null)"}`);
      console.log(`      received_at_hpd: ${it.received_at_hpd ? "true" : "false"}`);
      console.log(`      ship_tracking:   ${it.ship_tracking || "(empty)"}`);
      console.log(`      buy_sheet_lines: ${lines.length} lines  ${JSON.stringify(orderedQtys)}`);
      console.log(`      received_qtys:   ${JSON.stringify(r)}`);
      console.log(`      ship_qtys:       ${JSON.stringify(s)}`);
      console.log(`      sample_qtys:     ${JSON.stringify(samples)}`);
      console.log(`      → finalQtys:     ${JSON.stringify(finalQtys)}  (total ${total}, sizes shown: ${sizesShown.length})`);

      // Filter checks for the three call paths
      const passesFilter1Job = true; // no decorator, no tracking → all pass
      const passesFilter1Portal = it.ship_tracking ? true : false; // would be filtered by ship_tracking match
      const trackParam = job.fulfillment_tracking || "";
      const passesFilter1Email = (it.ship_tracking || "") === trackParam;
      const passesFilter2 = it.pipeline_stage === "shipped" || it.received_at_hpd || !!it.ship_tracking;
      console.log(`      filter pass — job:${passesFilter1Job && passesFilter2}  portal:${passesFilter1Portal && passesFilter2}  email:${passesFilter1Email && passesFilter2}`);
    }
    console.log("");
  }
})().catch(e => { console.error(e); process.exit(1); });
