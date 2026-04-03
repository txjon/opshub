#!/usr/bin/env node
/**
 * Compare costing vs PO calculations for all active jobs.
 * Flags any items where the two disagree.
 *
 * Usage: node scripts/compare-calcs.js
 */

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const fmt = (n) => "$" + Number(n || 0).toFixed(2);

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
  const minQty = pr.qtys?.[0] || 0;
  if (qty < minQty && pr.minimums?.tagPrint > 0) return pr.minimums.tagPrint / qty;
  let idx = 0;
  for (let i = 0; i < pr.qtys.length; i++) { if (qty >= pr.qtys[i]) idx = i; }
  return pr.tagPrices[idx] ?? 0;
}

function calcItem(p, pr, allProds, margin, inclShip, inclCC) {
  const qty = p.totalQty || 0;
  if (qty === 0) return null;

  // Blank cost
  const blankCost = Object.entries(p.blankCosts || {}).reduce((a, [sz, cost]) => {
    return a + (parseFloat(cost) || 0) * (p.qtys?.[sz] || 0);
  }, 0) * 1.035;

  // Print total
  let printTotal = 0;
  let sharedScreensToSkip = 0;
  const seenShareGroups = {};
  for (let loc = 1; loc <= 6; loc++) {
    const ld = p.printLocations?.[loc];
    if (!ld?.screens || ld.screens <= 0) continue;
    const isShared = !!(ld.shared) && ld.shareGroup;
    const groupKey = isShared ? ld.shareGroup.trim().toLowerCase() : "";
    let effectiveQty = qty;
    if (isShared) {
      effectiveQty = allProds.reduce((sum, cp) => {
        const matchingLocs = Object.values(cp.printLocations || {}).filter(l => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === groupKey && l.screens > 0);
        return sum + (matchingLocs.length > 0 ? (cp.totalQty || 0) * matchingLocs.length : 0);
      }, 0) || qty;
    }
    printTotal += lookupPrintPrice(pr, effectiveQty, ld.screens);
    if (isShared) {
      if (seenShareGroups[groupKey]) {
        sharedScreensToSkip += (parseFloat(ld.screens) || 0);
      } else {
        seenShareGroups[groupKey] = true;
      }
    }
  }

  // Tag
  if (p.tagPrint && pr) {
    const tagGroup = p.tagShareGroup || "";
    let tagEffQty = qty;
    if (p.tagShared && tagGroup) {
      tagEffQty = allProds.reduce((sum, cp) => {
        if (cp.tagPrint && cp.tagShared && cp.tagShareGroup?.trim().toLowerCase() === tagGroup.trim().toLowerCase()) return sum + (cp.totalQty || 0);
        return sum;
      }, 0) || qty;
    }
    printTotal += lookupTagPrice(pr, tagEffQty);
  }

  // Finishing
  let finUnitRate = 0;
  if (p.finishingQtys && pr) {
    if (p.finishingQtys.Packaging_on && p.finishingQtys.Packaging_variant) {
      finUnitRate += pr.packaging?.[p.finishingQtys.Packaging_variant] || 0;
    }
    for (const [key, val] of Object.entries(p.finishingQtys)) {
      if (key.endsWith("_on") && val && key !== "Packaging_on") {
        const fk = key.replace("_on", "");
        finUnitRate += pr.finishing?.[fk] || 0;
      }
    }
  }

  // Specialty
  const sg2 = {};
  const activeLocsDeduped = [1,2,3,4,5,6].filter(loc => {
    const ld = p.printLocations?.[loc];
    if (!ld?.location && !ld?.screens) return false;
    if (ld.shared && ld.shareGroup) { const gk = ld.shareGroup.trim().toLowerCase(); if (sg2[gk]) return false; sg2[gk] = true; }
    return true;
  }).length || 0;
  const activeLocsRaw = [1,2,3,4,5,6].filter(loc => { const ld = p.printLocations?.[loc]; return ld?.location || ld?.screens > 0; }).length;

  let specUnitRate = 0;
  if (p.specialtyQtys && pr) {
    for (const [key, rate] of Object.entries(pr.specialty || {})) {
      const isFleece = key.toLowerCase().includes("fleece");
      const isOn = isFleece ? p.isFleece : p.specialtyQtys[key + "_on"];
      if (isOn) {
        const stored = p.specialtyQtys[key + "_count"] || 0;
        const count = isFleece ? (activeLocsRaw + (p.tagPrint ? 1 : 0)) : (stored > 0 && stored < activeLocsDeduped ? stored : activeLocsDeduped);
        specUnitRate += (rate || 0) * count;
      }
    }
  }

  // Setup
  let setupTotal = 0;
  if (pr?.setup) {
    const autoScreens = Math.max(0, [1,2,3,4,5,6].reduce((a, loc) => a + (parseFloat(p.printLocations?.[loc]?.screens) || 0), 0) - sharedScreensToSkip);
    for (const [k, unitCost] of Object.entries(pr.setup)) {
      if (!unitCost) continue;
      const kLower = k.toLowerCase().replace(/\s/g, "");
      if (kLower === "screens") setupTotal += unitCost * autoScreens;
      else if (kLower === "tagscreens") {
        if (p.tagPrint && !p.tagRepeat) setupTotal += unitCost * (p.sizes || []).length;
      } else {
        // Check specialty link
        let specCount = null;
        for (const sk of Object.keys(p.specialtyQtys || {})) {
          if (sk.endsWith("_on") && p.specialtyQtys[sk]) {
            const specName = sk.replace("_on", "").toLowerCase();
            if (kLower.includes(specName)) {
              if (kLower.includes("puff") && kLower.includes("screen")) {
                const spg = {};
                specCount = [1,2,3,4,5,6].reduce((sum, loc) => {
                  const ld = p.printLocations?.[loc];
                  if (!ld?.location || !ld?.screens || !ld.puffColors) return sum;
                  if (ld.shared && ld.shareGroup) { const gk = ld.shareGroup.trim().toLowerCase(); if (spg[gk]) return sum; spg[gk] = true; }
                  return sum + (ld.puffColors || 0);
                }, 0);
              } else {
                const sc = p.specialtyQtys[sk.replace("_on", "_count")] || 0;
                specCount = sc > 0 && sc < activeLocsDeduped ? sc : activeLocsDeduped;
              }
            }
          }
        }
        if (specCount !== null) setupTotal += unitCost * specCount;
        else setupTotal += unitCost * (parseFloat(p.setupFees?.[k]) || 0);
      }
    }
    setupTotal += parseFloat(p.setupFees?.manualCost) || 0;
  }

  // Custom
  const customTotal = (p.customCosts || []).reduce((a, c) => {
    const v = parseFloat(c.perUnit || c.amount) || 0;
    const isFlat = c.flat === true || c.flat === "true";
    return a + (isFlat ? v : v * qty);
  }, 0);

  const perUnitPORate = printTotal + finUnitRate + specUnitRate;
  const poTotal = perUnitPORate * qty + setupTotal + customTotal;
  const shipping = inclShip && p.garment_type !== "accessory" ? qty * (p.isFleece ? 1.50 : 0.65) : 0;
  const totalCost = blankCost + poTotal + shipping;

  return { qty, blankCost, poTotal, shipping, totalCost, customTotal, setupTotal, printPerUnit: printTotal, finPerUnit: finUnitRate, specPerUnit: specUnitRate };
}

async function main() {
  console.log("Loading jobs...\n");

  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, title, job_number, costing_data, costing_summary, clients(name)")
    .not("costing_data", "is", null)
    .in("phase", ["intake", "pending", "ready", "production", "receiving", "fulfillment"])
    .order("created_at", { ascending: false });

  const { data: decorators } = await supabase.from("decorators").select("*");
  const PRINTERS = {};
  for (const d of (decorators || [])) {
    const key = d.short_code || d.name;
    if (d.pricing_data) PRINTERS[key] = { ...d.pricing_data, capabilities: d.capabilities || [] };
    else PRINTERS[key] = { qtys: [], prices: {}, tagPrices: [], finishing: {}, setup: {}, specialty: {}, capabilities: d.capabilities || [] };
  }

  let issues = 0;

  for (const job of (jobs || [])) {
    const cd = job.costing_data;
    if (!cd?.costProds?.length) continue;
    const margin = cd.costMargin || "30%";
    const inclShip = cd.inclShip !== false;
    const inclCC = cd.inclCC !== false;

    console.log(`\n═══ ${job.job_number} — ${job.clients?.name} — ${job.title} ═══`);

    for (const p of cd.costProds) {
      const pr = PRINTERS[p.printVendor] || null;
      const result = calcItem(p, pr, cd.costProds, margin, inclShip, inclCC);
      if (!result) continue;

      // Compare with stored summary if available
      console.log(`  ${p.name} (${result.qty} units)`);
      console.log(`    Blanks: ${fmt(result.blankCost)}  PO: ${fmt(result.poTotal)}  Ship: ${fmt(result.shipping)}`);
      console.log(`    Print/unit: ${fmt(result.printPerUnit)}  Fin/unit: ${fmt(result.finPerUnit)}  Spec/unit: ${fmt(result.specPerUnit)}`);
      console.log(`    Setup: ${fmt(result.setupTotal)}  Custom: ${fmt(result.customTotal)}`);

      // Check for string values in custom costs
      for (const c of (p.customCosts || [])) {
        if (typeof c.perUnit === "string" && c.perUnit !== "") {
          console.log(`    ⚠️  Custom cost "${c.desc}" has string perUnit: "${c.perUnit}"`);
          issues++;
        }
        if (typeof c.flat !== "boolean" && c.flat !== undefined) {
          console.log(`    ⚠️  Custom cost "${c.desc}" has non-boolean flat: ${JSON.stringify(c.flat)}`);
          issues++;
        }
      }
    }
  }

  console.log(`\n\n${issues > 0 ? `⚠️  ${issues} data issues found` : "✅ No data issues found"}`);
}

main().catch(console.error);
