/**
 * Shared pricing engine — single source of truth for all cost calculations.
 * Used by: CostingTab (client), PO PDF route (server), Quote PDF route (server).
 *
 * All three consumers MUST use these functions to ensure consistent numbers.
 */

const MARGIN_TIERS: Record<string, number> = { "10%": 1.15, "15%": 1.26, "20%": 1.33, "25%": 1.43, "30%": 1.53 };

export function buildPrintersMap(decorators: any[]): Record<string, any> {
  const map: Record<string, any> = {};
  for (const d of decorators) {
    const key = d.short_code || d.name;
    if (d.pricing_data) {
      map[key] = { ...d.pricing_data, capabilities: d.capabilities || [] };
    } else {
      map[key] = { qtys: [], prices: {}, tagPrices: [], finishing: {}, setup: {}, specialty: {}, capabilities: d.capabilities || [] };
    }
  }
  return map;
}

export function lookupPrintPrice(printers: Record<string, any>, pk: string, qty: number, colors: number): number {
  const p = printers[pk]; if (!p || !p.qtys?.length) return 0;
  const minQty = p.qtys[0] || 0;
  if (qty < minQty && p.minimums?.print > 0) return p.minimums.print / qty;
  let idx = 0; for (let i = 0; i < p.qtys.length; i++) { if (qty >= p.qtys[i]) idx = i; }
  const c = Math.min(Math.max(Math.round(colors), 1), 12);
  return p.prices[c]?.[idx] ?? 0;
}

export function lookupTagPrice(printers: Record<string, any>, pk: string, qty: number): number {
  const p = printers[pk]; if (!p || !p.tagPrices?.length) return 0;
  const minQty = p.qtys?.[0] || 0;
  if (qty < minQty && p.minimums?.tagPrint > 0) return p.minimums.tagPrint / qty;
  let idx = 0; for (let i = 0; i < p.qtys.length; i++) { if (qty >= p.qtys[i]) idx = i; }
  return p.tagPrices[idx] ?? 0;
}

export function calcCostProduct(p: any, margin: string, inclShip: boolean, inclCC: boolean, allProds: any[], printers: Record<string, any>) {
  const qty = p.totalQty || 0; if (qty === 0) return null;

  // Blank cost buffer: LA Apparel 10%, all others 5%
  const isLAApparel = (p.blank_vendor || p.blankVendor || "").startsWith("LA Apparel");
  const blankBuffer = isLAApparel ? 1.10 : 1.05;
  const blankCost = (() => {
    if (p.blankCosts && Object.keys(p.blankCosts).length > 0) {
      let total = 0;
      Object.entries(p.blankCosts).forEach(([sz, cost]: [string, any]) => { total += (cost || 0) * (p.qtys?.[sz] || 0) * blankBuffer; });
      return total;
    }
    return (p.blankCostPerUnit || 0) * qty * blankBuffer;
  })();

  // Print total + shared screen tracking
  let printTotal = 0;
  let sharedScreensToSkip = 0;
  const seenShareGroups: Record<string, boolean> = {};

  for (let loc = 1; loc <= 6; loc++) {
    const ld = p.printLocations?.[loc];
    const printer = ld?.printer || p.printVendor;
    if (printer && ld?.screens > 0) {
      const isShared = !!(ld.shared) && ld.shareGroup;
      const groupKey = isShared ? ld.shareGroup.trim().toLowerCase() : "";

      // Share group: qty × matching locations per item
      let sharedQty = 0;
      if (isShared) {
        sharedQty = allProds.reduce((sum: number, cp: any) => {
          const matchingLocs = Object.values(cp.printLocations || {}).filter((l: any) => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === groupKey && l.screens > 0);
          return sum + (matchingLocs.length > 0 ? (cp.totalQty || 0) * matchingLocs.length : 0);
        }, 0);
      }

      // Screen fee dedup: within same item + across items
      if (isShared) {
        if (seenShareGroups[groupKey]) {
          sharedScreensToSkip += (parseFloat(ld.screens) || 0);
        } else {
          seenShareGroups[groupKey] = true;
          const firstIdx = allProds.findIndex((cp: any) => Object.values(cp.printLocations || {}).some((l: any) => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === groupKey && l.screens > 0));
          const myIdx = allProds.findIndex((cp: any) => cp.id === p.id);
          if (firstIdx >= 0 && myIdx > firstIdx) sharedScreensToSkip += (parseFloat(ld.screens) || 0);
        }
      }

      const effectiveQty = isShared && sharedQty > 0 ? sharedQty : qty;
      printTotal += lookupPrintPrice(printers, printer, effectiveQty, ld.screens);
    }
  }

  // Tag print
  if (p.tagPrint && p.printVendor) {
    const tagGroup = p.tagShareGroup || "";
    let tagEffQty = qty;
    if (tagGroup && allProds) {
      tagEffQty = allProds.reduce((sum: number, cp: any) => {
        if (cp.tagPrint && cp.tagShareGroup && cp.tagShareGroup.trim().toLowerCase() === tagGroup.trim().toLowerCase()) return sum + (cp.totalQty || 0);
        return sum;
      }, 0) || qty;
    }
    printTotal += lookupTagPrice(printers, p.printVendor, tagEffQty);
  }

  // Finishing
  let finUnitRate = 0;
  if (p.finishingQtys && p.printVendor) {
    const pr = printers[p.printVendor];
    if (pr) {
      if (p.finishingQtys["Packaging_on"]) {
        const variant = p.isFleece ? "Fleece" : (p.finishingQtys["Packaging_variant"] || "Tee");
        finUnitRate += (pr.packaging?.[variant] || pr.finishing?.[variant] || 0);
      }
      Object.keys(p.finishingQtys || {}).forEach((fk: string) => {
        if (fk.endsWith("_on") && p.finishingQtys[fk]) {
          const key = fk.replace("_on", "");
          if (key !== "Packaging") { finUnitRate += (pr.specialty?.[key] || pr.finishing?.[key] || 0); }
        }
      });
    }
  }

  // Specialty (deduped for share groups)
  let specUnitRate = 0;
  if (p.specialtyQtys && p.printVendor) {
    const pr = printers[p.printVendor];
    if (pr) {
      const seenSG: Record<string, boolean> = {};
      const activeLocsDeduped = [1, 2, 3, 4, 5, 6].filter(loc => {
        const ld = p.printLocations?.[loc];
        if (!ld?.location && !ld?.screens) return false;
        if (ld.shared && ld.shareGroup) { const gk = ld.shareGroup.trim().toLowerCase(); if (seenSG[gk]) return false; seenSG[gk] = true; }
        return true;
      }).length || 0;
      const activeLocsRaw = [1, 2, 3, 4, 5, 6].filter(loc => { const ld = p.printLocations?.[loc]; return ld?.location || ld?.screens > 0; }).length || 0;

      Object.keys(pr.specialty || {}).forEach((key: string) => {
        const isFleece = key === "Fleece Upcharge";
        const isOn = isFleece ? p.isFleece : p.specialtyQtys[key + "_on"];
        if (isOn) {
          const storedCount = p.specialtyQtys[key + "_count"] || 0;
          const count = isFleece ? (activeLocsRaw + (p.tagPrint ? 1 : 0)) : (storedCount > 0 && storedCount < activeLocsDeduped ? storedCount : activeLocsDeduped);
          specUnitRate += (pr.specialty?.[key] || 0) * count;
        }
      });
    }
  }

  // Setup fees
  let setupTotal = 0;
  if (p.setupFees) {
    const pr = printers[p.printVendor || p.setupFees?.printer];
    if (pr) {
      const autoScreens = Math.max(0, [1, 2, 3, 4, 5, 6].reduce((a: number, loc: number) => a + (parseFloat(p.printLocations?.[loc]?.screens) || 0), 0) - sharedScreensToSkip);
      const activeSizes = (p.sizes || []).filter((sz: string) => (p.qtys?.[sz] || 0) > 0).length;
      const sg2: Record<string, boolean> = {};
      const activeLocsDeduped2 = [1, 2, 3, 4, 5, 6].filter(loc => { const ld = p.printLocations?.[loc]; if (!ld?.location && !ld?.screens) return false; if (ld.shared && ld.shareGroup) { const gk = ld.shareGroup.trim().toLowerCase(); if (sg2[gk]) return false; sg2[gk] = true; } return true; }).length || 0;

      const isScreensKey = (k: string) => k === "Screens" || k.toLowerCase() === "screens";
      const isTagScreensKey = (k: string) => k === "TagScreens" || k === "Tag Screens" || k.toLowerCase().replace(/\s/g, "") === "tagscreens";
      const getSpecCountCalc = (setupKey: string): number | null => {
        const skLower = setupKey.toLowerCase();
        const specOnKeys = Object.keys(p.specialtyQtys || {}).filter((sk: string) => sk.endsWith("_on") && p.specialtyQtys[sk]);
        for (const sk of specOnKeys) {
          const specName = sk.replace("_on", "").toLowerCase();
          if (skLower.includes(specName)) {
            if (skLower.includes("puff") && skLower.includes("screen")) {
              const spg: Record<string, boolean> = {};
              return [1, 2, 3, 4, 5, 6].reduce((sum: number, loc: number) => {
                const ld = p.printLocations?.[loc];
                if (!ld?.location || !ld?.screens || !ld.puffColors) return sum;
                if (ld.shared && ld.shareGroup) { const gk = ld.shareGroup.trim().toLowerCase(); if (spg[gk]) return sum; spg[gk] = true; }
                return sum + (ld.puffColors || 0);
              }, 0);
            }
            const sc = p.specialtyQtys?.[sk.replace("_on", "_count")] || 0;
            return sc > 0 && sc < activeLocsDeduped2 ? sc : activeLocsDeduped2;
          }
        }
        return null;
      };

      Object.keys(pr.setup || {}).forEach((k: string) => {
        if (isScreensKey(k)) setupTotal += (pr.setup[k] || 0) * autoScreens;
        else if (isTagScreensKey(k) && !p.tagRepeat) setupTotal += (pr.setup[k] || 0) * (p.tagPrint ? activeSizes : (p.setupFees?.tagSizes || 0));
        else {
          const specCount = getSpecCountCalc(k);
          if (specCount !== null) setupTotal += (pr.setup[k] || 0) * specCount;
          else setupTotal += (pr.setup[k] || 0) * (p.setupFees?.[k] || 0);
        }
      });
    }
    if (p.setupFees.manualCost > 0) setupTotal += p.setupFees.manualCost;
  }

  // Custom costs
  const customTotal = (p.customCosts || []).reduce((a: number, c: any) => {
    const v = parseFloat(c.perUnit || c.amount) || 0;
    const isFlat = c.flat === true || c.flat === "true";
    return a + (isFlat ? v : v * qty);
  }, 0);

  // Totals
  const perUnitPORate = printTotal + finUnitRate + specUnitRate;
  const poTotal = perUnitPORate * qty + setupTotal + customTotal;
  const shipping = inclShip && p.garment_type !== "accessory" ? qty * (p.isFleece ? 1.50 : 0.65) : 0;
  const totalCost = blankCost + poTotal + shipping;
  const marginPct = (parseFloat((margin || "30%").replace("%", "")) / 100) || 0.30;
  const ccRate = inclCC ? 0.03 : 0;
  const divisor = 1 - marginPct - ccRate;
  const autoGrossRev = divisor > 0 ? (totalCost / divisor) : 0;
  const grossRevFinal = p.sellOverride ? p.sellOverride * qty : autoGrossRev;
  const sellPerUnitFinal = qty > 0 ? grossRevFinal / qty : 0;
  const ccFees = grossRevFinal * ccRate;
  const totalCostWithCC = totalCost + ccFees;
  const netProfit = grossRevFinal - totalCostWithCC;

  return {
    qty, blankCost, printTotal: printTotal * qty, finTotal: finUnitRate * qty,
    specTotal: specUnitRate, setupTotal, poTotal, shipping, ccFees,
    grossRev: grossRevFinal, totalCost: totalCostWithCC, netProfit,
    sellPerUnit: sellPerUnitFinal,
    margin_pct: grossRevFinal > 0 ? netProfit / grossRevFinal : 0,
    profitPerPiece: qty > 0 ? netProfit / qty : 0,
    customTotal, perUnitPORate,
  };
}
