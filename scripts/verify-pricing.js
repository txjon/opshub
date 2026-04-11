#!/usr/bin/env node
/**
 * Pricing Verification Script
 *
 * Pulls items.sell_per_unit from DB and shows exactly what every surface should display.
 * No recalculation — just reads the saved truth and does qty * sell_per_unit.
 *
 * Usage: node scripts/verify-pricing.js <jobId>
 * Or:    node scripts/verify-pricing.js  (lists recent jobs)
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function run() {
  const jobId = process.argv[2];

  if (!jobId) {
    console.log("\nRecent jobs:\n");
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, job_number, title, type_meta, clients(name), costing_summary")
      .order("created_at", { ascending: false })
      .limit(15);
    for (const j of (jobs || [])) {
      const inv = j.type_meta?.qb_invoice_number || "";
      const rev = j.costing_summary?.grossRev;
      console.log(`  ${j.id}  ${inv || j.job_number}  ${j.clients?.name || "—"}  ${j.title || ""}  ${rev ? fmt(rev) : "no costing"}`);
    }
    console.log("\nUsage: node scripts/verify-pricing.js <jobId>\n");
    return;
  }

  // Load job
  const { data: job } = await supabase
    .from("jobs")
    .select("*, clients(name)")
    .eq("id", jobId)
    .single();

  if (!job) { console.log("Job not found"); return; }

  const inv = job.type_meta?.qb_invoice_number || job.job_number;
  const locked = job.type_meta?.costing_locked || false;
  console.log("\n" + "=".repeat(70));
  console.log(`JOB: ${job.clients?.name || "—"} — ${job.title || ""}`);
  console.log(`Number: ${inv}  |  Phase: ${job.phase}  |  Costing locked: ${locked}`);
  console.log("=".repeat(70));

  // Load items with buy_sheet_lines
  const { data: items } = await supabase
    .from("items")
    .select("id, name, sell_per_unit, sort_order, garment_type, buy_sheet_lines(size, qty_ordered)")
    .eq("job_id", jobId)
    .order("sort_order");

  if (!items?.length) { console.log("No items found"); return; }

  console.log("\n  ITEMS (from items.sell_per_unit — the source of truth)\n");
  console.log("  " + "-".repeat(66));
  console.log(`  ${"Letter".padEnd(8)}${"Item".padEnd(30)}${"Qty".padStart(6)}${"$/Unit".padStart(10)}${"Line Total".padStart(14)}`);
  console.log("  " + "-".repeat(66));

  let grandTotal = 0;
  let totalUnits = 0;

  for (const item of items) {
    const letter = String.fromCharCode(65 + (item.sort_order ?? 0));
    const spu = parseFloat(item.sell_per_unit) || 0;
    const qty = (item.buy_sheet_lines || []).reduce((a, l) => a + (l.qty_ordered || 0), 0);
    const lineTotal = Math.round(spu * qty * 100) / 100;
    grandTotal += lineTotal;
    totalUnits += qty;

    console.log(`  ${letter.padEnd(8)}${item.name.substring(0, 28).padEnd(30)}${String(qty).padStart(6)}${fmt(spu).padStart(10)}${fmt(lineTotal).padStart(14)}`);
  }

  console.log("  " + "-".repeat(66));
  console.log(`  ${"".padEnd(38)}${String(totalUnits).padStart(6)}${" ".padStart(10)}${fmt(grandTotal).padStart(14)}`);

  // Compare against saved costing_summary
  const cs = job.costing_summary;
  const qbTotal = job.type_meta?.qb_total_with_tax;
  const qbTax = job.type_meta?.qb_tax_amount || 0;

  console.log("\n  COMPARISON\n");
  console.log(`  Calculated from sell_per_unit:    ${fmt(grandTotal)}`);
  if (cs?.grossRev !== undefined) {
    console.log(`  Saved costing_summary.grossRev:  ${fmt(cs.grossRev)}  ${Math.abs(cs.grossRev - grandTotal) < 0.01 ? "MATCH" : "MISMATCH " + fmt(cs.grossRev - grandTotal)}`);
  }
  if (qbTotal !== undefined) {
    const qbSubtotal = qbTotal - qbTax;
    console.log(`  QB invoice total (with tax):     ${fmt(qbTotal)}`);
    console.log(`  QB invoice subtotal (no tax):    ${fmt(qbSubtotal)}  ${Math.abs(qbSubtotal - grandTotal) < 0.01 ? "MATCH" : "MISMATCH " + fmt(qbSubtotal - grandTotal)}`);
    if (qbTax > 0) console.log(`  QB sales tax:                    ${fmt(qbTax)}`);
  }

  // Load payments
  const { data: payments } = await supabase
    .from("payment_records")
    .select("amount, status, type")
    .eq("job_id", jobId);

  const totalPaid = (payments || []).filter(p => p.status === "paid").reduce((a, p) => a + p.amount, 0);
  const balance = grandTotal + qbTax - totalPaid;

  console.log(`\n  Paid:                            ${fmt(totalPaid)}`);
  console.log(`  Balance due:                     ${fmt(balance)}`);

  console.log("\n  WHAT EACH SURFACE SHOULD SHOW\n");
  console.log(`  Quote PDF subtotal:              ${fmt(grandTotal)}`);
  console.log(`  Invoice PDF subtotal:            ${fmt(grandTotal)}`);
  console.log(`  Invoice PDF amount due:          ${fmt(grandTotal + qbTax - totalPaid)}`);
  console.log(`  QB invoice total:                ${fmt(grandTotal + qbTax)}`);
  console.log(`  Client portal total:             ${fmt(qbTotal || grandTotal)}`);
  console.log(`  Client portal balance:           ${fmt(balance)}`);
  console.log(`  Costing tab revenue:             ${fmt(grandTotal)}`);

  // Per-item detail
  console.log("\n  PER-ITEM DETAIL\n");
  for (const item of items) {
    const letter = String.fromCharCode(65 + (item.sort_order ?? 0));
    const spu = parseFloat(item.sell_per_unit) || 0;
    const lines = item.buy_sheet_lines || [];
    const qty = lines.reduce((a, l) => a + (l.qty_ordered || 0), 0);
    console.log(`  ${letter}  ${item.name}`);
    console.log(`     sell_per_unit: ${fmt(spu)}  (DB value, rounded to cent)`);
    console.log(`     qty: ${qty}  |  ${fmt(spu)} x ${qty} = ${fmt(Math.round(spu * qty * 100) / 100)}`);
    if (lines.length > 0) {
      const sizeStr = lines.filter(l => l.qty_ordered > 0).map(l => `${l.size}:${l.qty_ordered}`).join("  ");
      console.log(`     sizes: ${sizeStr}`);
    }
    console.log();
  }

  console.log("=".repeat(70) + "\n");
}

run().catch(console.error);
