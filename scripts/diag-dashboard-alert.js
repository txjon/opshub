#!/usr/bin/env node
/**
 * Run the dashboard's order_blanks alert logic against a single job and
 * print the inputs + outcome. Helps explain why a job lands (or doesn't)
 * in the Decorators column.
 *
 * Usage: node scripts/diag-dashboard-alert.js <invoiceNumber>
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const inv = process.argv[2];
if (!inv) { console.error("Usage: node scripts/diag-dashboard-alert.js <invNum>"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Match dashboard's query exactly
  const { data: jobs } = await supabase
    .from("jobs")
    .select("*, clients(name), quote_approved, quote_approved_at, type_meta, costing_data, costing_summary, payment_terms, shipping_route, fulfillment_status, quote_rejection_notes, items(id, name, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, artwork_status, garment_type, received_at_hpd, pipeline_timestamps, buy_sheet_lines(qty_ordered), decorator_assignments(decorators(name, short_code)))")
    .filter("type_meta->>qb_invoice_number", "eq", inv);

  const j = jobs?.[0];
  if (!j) { console.log(`#${inv} not found`); process.exit(0); }

  console.log(`\n#${inv} · ${j.job_number} · ${j.title}`);
  console.log(`  phase: ${j.phase}`);
  console.log(`  quote_approved: ${j.quote_approved}`);
  console.log(`  payment_terms: ${j.payment_terms}`);

  // Reproduce dashboard logic
  const items = j.items || [];
  const apparelItems = items.filter(it => it.garment_type !== "accessory");
  const needsBlanks = apparelItems.filter(it => (it.blanks_order_cost ?? 0) <= 0);

  console.log(`\n  Items (${items.length} total, ${apparelItems.length} apparel by current filter):`);
  for (const it of items) {
    const cost = it.blanks_order_cost;
    const isApparel = it.garment_type !== "accessory";
    const wouldNeedBlanks = isApparel && (cost ?? 0) <= 0;
    const flag = wouldNeedBlanks ? "⚠ TRIPS" : isApparel ? "  ok    " : "  skip  ";
    console.log(
      `  ${flag} garment_type=${(it.garment_type || "(null)").padEnd(14)} ` +
      `cost=${cost === null ? "null" : `$${Number(cost).toFixed(4)}`} ` +
      `· ${it.name}`
    );
  }

  console.log(`\n  needsBlanks count: ${needsBlanks.length}`);
  if (needsBlanks.length > 0) {
    console.log(`  Items tripping the alert:`);
    needsBlanks.forEach(it => console.log(`    - ${it.name} (garment_type="${it.garment_type}", cost=${it.blanks_order_cost})`));
  }
})().catch(e => { console.error(e); process.exit(1); });
