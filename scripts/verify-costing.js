#!/usr/bin/env node
/**
 * Costing Verification Script
 *
 * Pulls a real job's costing data from the DB and prints every
 * calculation step so you can compare against your Excel.
 *
 * Usage: node scripts/verify-costing.js <jobId>
 * Or:    node scripts/verify-costing.js  (lists all jobs to pick from)
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MARGIN_TIERS = { "10%": 1.15, "15%": 1.26, "20%": 1.33, "25%": 1.43, "30%": 1.53 };

function lookupPrintPrice(pr, qty, colors) {
  if (!pr?.qtys?.length) return 0;
  const minQty = pr.qtys[0] || 0;
  if (qty < minQty && pr.minimums?.print > 0) return pr.minimums.print / qty;
  let idx = 0;
  for (let i = 0; i < pr.qtys.length; i++) { if (qty >= pr.qtys[i]) idx = i; }
  const c = Math.min(Math.max(Math.round(colors), 1), 12);
  return pr.prices?.[c]?.[idx] ?? 0;
}

function lookupTagPrice(pr, qty) {
  if (!pr?.tagPrices?.length) return 0;
  const minQty = pr.qtys[0] || 0;
  if (qty < minQty && pr.minimums?.tagPrint > 0) return pr.minimums.tagPrint / qty;
  let idx = 0;
  for (let i = 0; i < pr.qtys.length; i++) { if (qty >= pr.qtys[i]) idx = i; }
  return pr.tagPrices[idx] ?? 0;
}

async function verify(jobId) {
  // Load job
  const { data: job } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).single();
  if (!job) { console.error("Job not found"); process.exit(1); }

  // Load decorator pricing
  const { data: decorators } = await supabase.from("decorators").select("name, short_code, pricing_data").order("name");
  const PRINTERS = {};
  for (const d of (decorators || [])) {
    const key = d.short_code || d.name;
    if (d.pricing_data) PRINTERS[key] = d.pricing_data;
  }

  const cd = job.costing_data;
  if (!cd?.costProds?.length) { console.log("No costing data for this job."); process.exit(0); }

  const margin = cd.costMargin || "30%";
  const inclShip = cd.inclShip !== undefined ? cd.inclShip : true;
  const inclCC = cd.inclCC !== undefined ? cd.inclCC : true;

  console.log("\n" + "=".repeat(70));
  console.log(`JOB: ${job.clients?.name || "—"} — ${job.title}`);
  console.log(`Job #: ${job.job_number}  |  Margin: ${margin}  |  Ship: ${inclShip ? "Yes" : "No"}  |  CC: ${inclCC ? "Yes" : "No"}`);
  console.log("=".repeat(70));

  let grandTotalRev = 0, grandTotalCost = 0, grandTotalProfit = 0, grandTotalQty = 0;

  for (const p of cd.costProds) {
    const qty = p.totalQty || 0;
    if (qty === 0) { console.log(`\n  SKIP: ${p.name} (0 qty)`); continue; }

    const pr = PRINTERS[p.printVendor] || null;

    console.log(`\n${"─".repeat(70)}`);
    console.log(`  ITEM: ${p.name}`);
    console.log(`  Vendor: ${p.printVendor || "—"}  |  Qty: ${qty}  |  Fleece: ${p.isFleece ? "Yes" : "No"}`);
    console.log(`${"─".repeat(70)}`);

    // 1. BLANK COST
    let blankCost = 0;
    if (p.blankCosts && Object.keys(p.blankCosts).length > 0) {
      console.log("\n  BLANK COSTS (per size × qty × 1.035 buffer):");
      for (const [sz, cost] of Object.entries(p.blankCosts)) {
        const szQty = p.qtys?.[sz] || 0;
        const line = (cost || 0) * szQty * 1.035;
        if (szQty > 0) console.log(`    ${sz}: ${fmt(cost)} × ${szQty} × 1.035 = ${fmt(line)}`);
        blankCost += line;
      }
    } else {
      blankCost = (p.blankCostPerUnit || 0) * qty * 1.035;
      console.log(`\n  BLANK COST: ${fmt(p.blankCostPerUnit)} × ${qty} × 1.035 = ${fmt(blankCost)}`);
    }
    console.log(`  BLANK TOTAL: ${fmt(blankCost)}`);

    // 2. PRINT COST
    let printTotal = 0;
    const activeLocs = [1, 2, 3, 4, 5, 6].filter(loc => {
      const ld = p.printLocations?.[loc];
      return ld?.location || ld?.screens > 0;
    });
    console.log(`\n  PRINT LOCATIONS (${activeLocs.length} active):`);
    for (const loc of activeLocs) {
      const ld = p.printLocations[loc];
      const screens = parseFloat(ld.screens) || 0;
      if (screens === 0) continue;
      const rate = lookupPrintPrice(pr, qty, screens);
      console.log(`    Loc ${loc} "${ld.location || "—"}": ${screens} screens → ${fmt(rate)}/unit`);
      printTotal += rate;
    }
    if (p.tagPrint && pr) {
      const tagRate = lookupTagPrice(pr, qty);
      console.log(`    Tag print: ${fmt(tagRate)}/unit`);
      printTotal += tagRate;
    }
    console.log(`  PRINT PER UNIT: ${fmt(printTotal)}  |  PRINT TOTAL: ${fmt(printTotal * qty)}`);

    // 3. FINISHING
    let finUnitRate = 0;
    if (p.finishingQtys && pr) {
      console.log("\n  FINISHING:");
      if (p.finishingQtys["Packaging_on"]) {
        const variant = p.isFleece ? "Fleece" : (p.finishingQtys["Packaging_variant"] || "Tee");
        const rate = pr.packaging?.[variant] || pr.finishing?.[variant] || 0;
        console.log(`    Packaging (${variant}): ${fmt(rate)}/unit`);
        finUnitRate += rate;
      }
      for (const fk of Object.keys(p.finishingQtys)) {
        if (fk.endsWith("_on") && p.finishingQtys[fk] && fk !== "Packaging_on") {
          const key = fk.replace("_on", "");
          const rate = pr.specialty?.[key] || pr.finishing?.[key] || 0;
          console.log(`    ${key}: ${fmt(rate)}/unit`);
          finUnitRate += rate;
        }
      }
      if (p.isFleece) {
        const locs = activeLocs.length + (p.tagPrint ? 1 : 0);
        const rate = (pr.packaging?.Tee || pr.finishing?.Tee || 0) * locs;
        console.log(`    Fleece upcharge: ${fmt(pr.packaging?.Tee || pr.finishing?.Tee || 0)} × ${locs} prints = ${fmt(rate)}/unit`);
        finUnitRate += rate;
      }
    }
    console.log(`  FINISHING PER UNIT: ${fmt(finUnitRate)}  |  FINISHING TOTAL: ${fmt(finUnitRate * qty)}`);

    // 4. SPECIALTY
    let specUnitRate = 0;
    if (p.specialtyQtys && pr) {
      console.log("\n  SPECIALTY:");
      for (const key of Object.keys(pr.specialty || {})) {
        if (p.specialtyQtys[key + "_on"]) {
          const count = p.specialtyQtys[key + "_count"] !== undefined ? p.specialtyQtys[key + "_count"] : activeLocs.length;
          const rate = (pr.specialty[key] || 0) * count;
          console.log(`    ${key}: ${fmt(pr.specialty[key])} × ${count} prints = ${fmt(rate)}/unit`);
          specUnitRate += rate;
        }
      }
    }
    if (specUnitRate > 0) console.log(`  SPECIALTY PER UNIT: ${fmt(specUnitRate)}`);

    // 5. SETUP FEES
    let setupTotal = 0;
    if (p.setupFees && pr) {
      console.log("\n  SETUP FEES:");
      const autoScreens = [1, 2, 3, 4, 5, 6].reduce((a, loc) => a + (parseFloat(p.printLocations?.[loc]?.screens) || 0), 0);
      const activeSizes = (p.sizes || []).filter(sz => (p.qtys?.[sz] || 0) > 0).length;

      for (const k of Object.keys(pr.setup || {})) {
        const unitCost = pr.setup[k] || 0;
        if (unitCost === 0) continue;
        const isScreens = k === "Screens" || k.toLowerCase() === "screens";
        const isTagScreens = k === "TagScreens" || k === "Tag Screens" || k.toLowerCase().replace(/\s/g, "") === "tagscreens";

        let feeQty = 0;
        if (isScreens) { feeQty = autoScreens; }
        else if (isTagScreens && !p.tagRepeat) { feeQty = p.tagPrint ? activeSizes : (p.setupFees?.tagSizes || 0); }
        else {
          // Check specialty link
          const skLower = k.toLowerCase();
          let specCount = null;
          for (const sk of Object.keys(p.specialtyQtys || {})) {
            if (sk.endsWith("_on") && p.specialtyQtys[sk]) {
              const specName = sk.replace("_on", "").toLowerCase();
              if (skLower.includes(specName)) { specCount = p.specialtyQtys[sk.replace("_on", "_count")] || 0; break; }
            }
          }
          feeQty = specCount !== null ? specCount : (p.setupFees?.[k] || 0);
        }
        const total = unitCost * feeQty;
        if (feeQty > 0) console.log(`    ${k}: ${fmt(unitCost)} × ${feeQty} = ${fmt(total)}`);
        setupTotal += total;
      }
      if (p.setupFees.manualCost > 0) {
        console.log(`    Manual: ${fmt(p.setupFees.manualCost)}`);
        setupTotal += p.setupFees.manualCost;
      }
    }
    const customTotal = (p.customCosts || []).reduce((a, c) => a + (c.amount || 0), 0);
    if (customTotal > 0) console.log(`    Custom costs: ${fmt(customTotal)}`);
    console.log(`  SETUP TOTAL: ${fmt(setupTotal + customTotal)}`);

    // 6-13. TOTALS
    const perUnitPORate = printTotal + finUnitRate + specUnitRate;
    const poTotal = perUnitPORate * qty + setupTotal + customTotal;
    const shipping = inclShip ? qty * (p.isFleece ? 1.50 : 0.65) : 0;
    const totalCost = blankCost + poTotal + shipping;
    const marginPct = (parseFloat((margin || "30%").replace("%", "")) / 100) || 0.30;
    const ccRate = inclCC ? 0.03 : 0;
    const divisor = 1 - marginPct - ccRate;
    const autoGrossRev = divisor > 0 ? (totalCost / divisor) : 0;
    const grossRev = p.sellOverride ? p.sellOverride * qty : autoGrossRev;
    const sellPerUnit = qty > 0 ? grossRev / qty : 0;
    const ccFees = grossRev * ccRate;
    const totalCostWithCC = totalCost + ccFees;
    const netProfit = grossRev - totalCostWithCC;
    const marginActual = grossRev > 0 ? netProfit / grossRev : 0;

    console.log("\n  ┌─────────────────────────────────────────────┐");
    console.log(`  │  PO per unit:  ${fmt(perUnitPORate).padStart(12)}                    │`);
    console.log(`  │  PO total:     ${fmt(poTotal).padStart(12)}                    │`);
    console.log(`  │  Shipping:     ${fmt(shipping).padStart(12)}  (${p.isFleece ? "$1.50" : "$0.65"}/unit)     │`);
    console.log(`  │  Blank cost:   ${fmt(blankCost).padStart(12)}                    │`);
    console.log(`  │  TOTAL COST:   ${fmt(totalCost).padStart(12)}                    │`);
    console.log(`  │─────────────────────────────────────────────│`);
    console.log(`  │  Margin:       ${(marginPct * 100).toFixed(0)}%  |  CC: ${(ccRate * 100).toFixed(0)}%  |  Divisor: ${divisor.toFixed(4)}  │`);
    console.log(`  │  Formula:      ${fmt(totalCost)} / ${divisor.toFixed(4)} = ${fmt(autoGrossRev)}   │`);
    if (p.sellOverride) console.log(`  │  SELL OVERRIDE: ${fmt(p.sellOverride)}/unit × ${qty} = ${fmt(grossRev)}  │`);
    console.log(`  │  Sell/unit:    ${fmt(sellPerUnit).padStart(12)}                    │`);
    console.log(`  │  GROSS REV:    ${fmt(grossRev).padStart(12)}                    │`);
    console.log(`  │  CC fees:      ${fmt(ccFees).padStart(12)}                    │`);
    console.log(`  │  NET PROFIT:   ${fmt(netProfit).padStart(12)}                    │`);
    console.log(`  │  MARGIN:       ${(marginActual * 100).toFixed(1).padStart(10)}%                    │`);
    console.log(`  │  Profit/piece: ${fmt(qty > 0 ? netProfit / qty : 0).padStart(12)}                    │`);
    console.log("  └─────────────────────────────────────────────┘");

    grandTotalRev += grossRev;
    grandTotalCost += totalCostWithCC;
    grandTotalProfit += netProfit;
    grandTotalQty += qty;
  }

  console.log("\n" + "=".repeat(70));
  console.log("  GRAND TOTALS");
  console.log("=".repeat(70));
  console.log(`  Revenue:      ${fmt(grandTotalRev)}`);
  console.log(`  Cost:         ${fmt(grandTotalCost)}`);
  console.log(`  Profit:       ${fmt(grandTotalProfit)}`);
  console.log(`  Units:        ${grandTotalQty.toLocaleString()}`);
  console.log(`  Margin:       ${grandTotalRev > 0 ? (grandTotalProfit / grandTotalRev * 100).toFixed(1) : 0}%`);
  console.log(`  Avg/unit:     ${fmt(grandTotalQty > 0 ? grandTotalRev / grandTotalQty : 0)}`);
  console.log("");
}

async function main() {
  const jobId = process.argv[2];
  if (jobId) {
    await verify(jobId);
  } else {
    // List jobs to pick from
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, job_number, title, clients(name)")
      .not("costing_data", "is", null)
      .order("created_at", { ascending: false })
      .limit(20);

    if (!jobs?.length) { console.log("No jobs with costing data found."); process.exit(0); }
    console.log("\nJobs with costing data:\n");
    for (const j of jobs) {
      console.log(`  ${j.job_number}  ${(j.clients?.name || "—").padEnd(25)} ${j.title}`);
      console.log(`  → node scripts/verify-costing.js ${j.id}\n`);
    }
  }
}

main().catch(console.error);
