export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { calculateMilestones } from "@/lib/dates";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";

const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; if (bi === -1) return -1;
  return ai - bi;
});
const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Pricing — loaded from decorators.pricing_data at request time ─────────────
let PRINTERS: Record<string, any> = {};

async function loadPrinters(supabase: any) {
  const { data } = await supabase.from("decorators").select("name, short_code, pricing_data").order("name");
  if (!data) return;
  for (const d of data) {
    const key = d.short_code || d.name;
    if (d.pricing_data) {
      PRINTERS[key] = d.pricing_data;
    } else {
      PRINTERS[key] = { qtys:[], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{} };
    }
  }
}

function getPrintRate(pr: any, qty: number, colors: number): number {
  if (!pr?.qtys || !pr?.prices) return 0;
  const minQty = pr.qtys[0] || 0;
  if (qty < minQty && pr.minimums?.print > 0) return pr.minimums.print / qty;
  const c = Math.min(Math.max(colors, 1), 12);
  const tiers = pr.qtys;
  let idx = tiers.length - 1;
  for (let i = 0; i < tiers.length; i++) { if (qty < tiers[i]) { idx = Math.max(0, i - 1); break; } }
  return pr.prices[c]?.[idx] || 0;
}

function calcDecorationLines(p: any, allProds: any[] = []): { label: string; qty: number; rate: number; total: number }[] {
  const lines: { label: string; qty: number; rate: number; total: number }[] = [];
  const pr = PRINTERS[p.printVendor];
  if (!pr) return lines;
  const qty = p.totalQty || 0;
  if (qty === 0) return lines;

  // Print locations
  const activeLocs = [1,2,3,4,5,6].filter(loc => {
    const ld = p.printLocations?.[loc];
    return ld?.location || ld?.screens > 0;
  });

  let sharedScreensToSkip = 0;
  for (const loc of activeLocs) {
    const ld = p.printLocations[loc];
    if (!ld?.location && !ld?.screens) continue;
    const screens = parseFloat(ld.screens) || 0;
    if (screens === 0) continue;
    // Share group: use combined qty for rate lookup
    const isShared = !!(ld.shared) && ld.shareGroup;
    const effectiveQty = isShared ? allProds.reduce((sum: number, cp: any) => {
      const match = Object.values(cp.printLocations || {}).find((l: any) => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === ld.shareGroup.trim().toLowerCase() && l.screens > 0);
      return sum + (match ? (cp.totalQty || 0) : 0);
    }, 0) || qty : qty;
    const rate = getPrintRate(pr, effectiveQty, screens);
    lines.push({ label: ld.location || `Location ${loc}`, qty, rate, total: rate * qty });
    // Skip screen fees if not first in group
    if (isShared) {
      const firstIdx = allProds.findIndex((cp: any) => Object.values(cp.printLocations || {}).some((l: any) => l.shared && l.shareGroup && l.shareGroup.trim().toLowerCase() === ld.shareGroup.trim().toLowerCase() && l.screens > 0));
      const myIdx = allProds.findIndex((cp: any) => cp.id === p.id);
      if (firstIdx >= 0 && myIdx > firstIdx) sharedScreensToSkip += screens;
    }
  }

  // Tag print — use shared group qty for rate lookup if tag is shared
  if (p.tagPrint) {
    const tagGroup = p.tagShareGroup || "";
    let tagEffQty = qty;
    if (p.tagShared && tagGroup && allProds) {
      tagEffQty = allProds.reduce((sum: number, cp: any) => {
        if (cp.tagPrint && cp.tagShared && cp.tagShareGroup && cp.tagShareGroup.trim().toLowerCase() === tagGroup.trim().toLowerCase()) return sum + (cp.totalQty || 0);
        return sum;
      }, 0) || qty;
    }
    const minQty = pr.qtys?.[0] || 0;
    const tagRate = (tagEffQty < minQty && pr.minimums?.tagPrint > 0) ? pr.minimums.tagPrint / tagEffQty : (pr.tagPrices?.[pr.qtys?.findIndex((q: number) => tagEffQty < q) - 1 || 0] || 0);
    lines.push({ label: "Tag print", qty, rate: tagRate, total: tagRate * qty });
  }

  // Finishing — dynamic from decorator pricing
  if (p.finishingQtys) {
    // Packaging
    if (p.finishingQtys["Packaging_on"]) {
      const variant = p.isFleece ? "Fleece" : (p.finishingQtys["Packaging_variant"] || "Tee");
      const rate = pr.packaging?.[variant] || pr.finishing?.[variant] || 0;
      if (rate > 0) lines.push({ label: `Packaging (${variant})`, qty, rate, total: rate * qty });
    }
    // Dynamic finishing items
    for (const fk of Object.keys(p.finishingQtys)) {
      if (fk.endsWith("_on") && p.finishingQtys[fk] && fk !== "Packaging_on") {
        const key = fk.replace("_on", "");
        const rate = pr.finishing?.[key] || pr.specialty?.[key] || 0;
        if (rate > 0) lines.push({ label: key, qty, rate, total: rate * qty });
      }
    }
    // Fleece upcharge (from specialty, automatic when isFleece)
    if (p.isFleece && pr.specialty?.["Fleece Upcharge"]) {
      const locsCount = activeLocs.length + (p.tagPrint ? 1 : 0);
      const rate = (pr.specialty["Fleece Upcharge"] || 0) * locsCount;
      if (rate > 0) lines.push({ label: "Fleece Upcharge", qty, rate, total: rate * qty });
    }
  }

  // Specialty — dynamic from decorator pricing
  if (p.specialtyQtys) {
    for (const key of Object.keys(pr.specialty || {})) {
      if (p.specialtyQtys[key + "_on"]) {
        const count = p.specialtyQtys[key + "_count"] !== undefined ? p.specialtyQtys[key + "_count"] : activeLocs.length;
        const rate = (pr.specialty[key] || 0) * count;
        if (rate > 0) lines.push({ label: key.replace(/([A-Z])/g, " $1").trim(), qty, rate, total: rate * qty });
      }
    }
  }

  // Setup fees — dynamic from decorator pricing
  if (p.setupFees) {
    const isScreensKey = (k: string) => k === "Screens" || k.toLowerCase() === "screens";
    const isTagScreensKey = (k: string) => k === "TagScreens" || k === "Tag Screens" || k.toLowerCase().replace(/\s/g, "") === "tagscreens";
    const autoScreens = Math.max(0, [1,2,3,4,5,6].reduce((a: number, loc: number) => a + (parseFloat(p.printLocations?.[loc]?.screens) || 0), 0) - sharedScreensToSkip);
    const activeSizes = (p.sizes || []).filter((sz: string) => (p.qtys?.[sz] || 0) > 0).length;

    // Check if a setup key links to an active specialty
    const getSpecCount = (setupKey: string): number | null => {
      const skLower = setupKey.toLowerCase();
      for (const sk of Object.keys(p.specialtyQtys || {})) {
        if (sk.endsWith("_on") && p.specialtyQtys[sk]) {
          const specName = sk.replace("_on", "").toLowerCase();
          if (skLower.includes(specName)) return p.specialtyQtys[sk.replace("_on", "_count")] || 0;
        }
      }
      return null;
    };

    for (const k of Object.keys(pr.setup || {})) {
      const unitCost = pr.setup[k] || 0;
      if (unitCost === 0) continue;
      let feeQty = 0;
      let label = k;

      if (isScreensKey(k)) {
        feeQty = autoScreens;
        label = `Screen fees (${autoScreens} screens)`;
      } else if (isTagScreensKey(k)) {
        if (p.tagRepeat) continue;
        feeQty = p.tagPrint ? activeSizes : (p.setupFees.tagSizes || 0);
        if (feeQty === 0) continue;
        label = `Tag screen fees (${feeQty} sizes)`;
      } else {
        const specCount = getSpecCount(k);
        if (specCount !== null) {
          feeQty = specCount;
          label = `${k} (${feeQty})`;
        } else {
          feeQty = p.setupFees[k] || 0;
          if (feeQty === 0) continue;
          label = `${k} (${feeQty})`;
        }
      }

      if (feeQty > 0) lines.push({ label, qty: feeQty, rate: unitCost, total: unitCost * feeQty });
    }

    if (p.setupFees.manualCost > 0) {
      lines.push({ label: "Setup (manual)", qty: 1, rate: p.setupFees.manualCost, total: p.setupFees.manualCost });
    }
  }

  // Custom costs (per unit × qty, or flat)
  for (const c of (p.customCosts || [])) {
    const v = c.perUnit || c.amount || 0;
    if (v > 0) {
      if (c.flat) lines.push({ label: c.desc || c.label || "Custom", qty: 1, rate: v, total: v });
      else lines.push({ label: c.desc || c.label || "Custom", qty, rate: v, total: v * qty });
    }
  }

  return lines;
}

const HPD_LOGO_SVG = `<svg style="height:28px;display:block" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#000000" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#000000" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#000000" d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/><path fill="#000000" d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/><path fill="#000000" d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03l-.25.11-.1.04-.3.1h-.02l-.35.11-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09l-.37.01-.37,0c-.03,0-.06,0-.08,0h-.03l-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0l-.1-.02-.45-.08-.16-.03-.4-.09h-.04s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1l-.34-.11c-.03,0-.05-.02-.08-.03h-.02l-.24-.1h-.02s-.05-.03-.07-.04l-.32-.14h-.01l-.3-.16c-.02-.01-.05-.03-.07-.04h-.02l-.22-.14-.09-.05-.29-.18c-.96-.64-1.78-1.49-2.38-2.46l-.15-.25-.02-.04-.13-.24-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98l-.15-.5-.09-.38c-.08-.39-.13-.79-.15-1.19l-.01-.41,0-.41c.04-.7.17-1.4.39-2.07l.23-.6.14-.31c.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07l.04-.07.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46l.29-.18.09-.05.22-.13h.02s.05-.04.07-.05l.31-.16.32-.14c.02-.01.05-.02.07-.03h.02l.24-.1h.02s.05-.03.08-.04l.33-.11.34-.1c.02,0,.05-.01.08-.02h.03l.26-.07h.06l.38-.08h.02l.35-.04c.03,0,.05,0,.08,0h.03l.27-.02h.02s.06,0,.09,0l.37,0,.37,0h.09l.72.08h.1l.68.15.1.03.34.1h.02l.3.11.09.03.25.1.04.02.41.18.04.02.19.1h.02l.49.29h.02l.4.28.02.02s.05.04.08.06l.33.26.06.05.25.22.02.02.19.19.05.05.28.3.04.05.16.19.05.06.18.23h0l.14.21.09.13.11.18.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/></g><g><path fill="#000000" d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/><path fill="#000000" d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/><path fill="#000000" d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/><path fill="#000000" d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/><path fill="#000000" d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/><path fill="#000000" d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/><path fill="#000000" d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/><path fill="#000000" d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/><path fill="#000000" d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/><path fill="#000000" d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/><path fill="#000000" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>`;

function renderPOHTML(data: any): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;
  const mono = `ui-monospace, monospace`;

  let grandTotal = 0;

  const itemBlocks = data.items.map((item: any) => {
    const lines = sortSizes(Object.keys(item.qtys).filter((sz: string) => (item.qtys[sz] || 0) > 0));
    const sizeStr = lines.map((sz: string) => `${sz} ${item.qtys[sz]}`).join("  ·  ");
    const incoming = item.incoming_goods || (item.supplier ? "Blanks from " + item.supplier : "");
    const decoLines: { label: string; qty: number; rate: number; total: number }[] = item.decoLines || [];
    const itemTotal = decoLines.reduce((a: number, l: any) => a + l.total, 0);
    grandTotal += itemTotal;

    const decoSection = decoLines.length > 0 ? `
      <div style="margin-top:6px;border-top:0.5px solid #e8e8e8;padding-top:5px">
        <div style="font-size:7px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">Print & Decoration</div>
        <table style="width:100%;border-collapse:collapse;font-size:9px">
          ${decoLines.map((l: any) => `
            <tr>
              <td style="padding:1px 0;color:#444">${l.label}</td>
              <td style="padding:1px 6px;text-align:right;color:#888;font-family:${mono}">${l.qty.toLocaleString()}×${fmtD(l.rate)}</td>
              <td style="padding:1px 0;text-align:right;font-weight:700;font-family:${mono}">${fmtD(l.total)}</td>
            </tr>`).join("")}
          <tr style="border-top:0.5px solid #e0e0e0">
            <td colspan="2" style="padding:3px 0 1px;font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888">Item total</td>
            <td style="padding:3px 0 1px;text-align:right;font-size:11px;font-weight:800;font-family:${mono}">${fmtD(itemTotal)}</td>
          </tr>
        </table>
      </div>` : "";

    const thumbHtml = item.mockupThumb ? `<img src="${item.mockupThumb}" style="height:120px;width:auto;object-fit:contain;border-radius:4px;background:#f7f7f7;flex-shrink:0" crossorigin="anonymous" />` : "";

    return `<div style="border-left:3px solid #1a1a1a;padding-left:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700">${item.letter} — ${item.name}</div>
        <div style="font-size:10px;color:#888">${item.totalQty.toLocaleString()} units</div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:4px;font-size:9px;color:#555">
        ${item.blank_vendor ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Brand</span>${item.blank_vendor}</div>` : ""}
        ${item.blank_sku ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Color</span>${item.blank_sku}</div>` : ""}
        ${item.printVendor ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Decorator</span>${item.printVendor}</div>` : ""}
      </div>
      ${sizeStr ? `<div style="font-size:9px;color:#555;padding:3px 8px;background:#f7f7f7;border-radius:3px;margin-bottom:4px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-right:6px">Sizes</span>${sizeStr}
      </div>` : ""}
      ${item.drive_link ? `<div style="font-size:9px;margin-bottom:4px;padding:3px 8px;background:#f0f5ff;border-radius:3px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-right:6px">Production folder</span>
        <a href="${item.drive_link}" style="color:#1a56db">${item.drive_link}</a>
      </div>` : ""}
      <div style="display:flex;gap:16px;align-items:flex-start">
        ${thumbHtml ? `<div style="flex-shrink:0">${thumbHtml}</div>` : ""}
        <div style="flex:1;min-width:0">${decoSection}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-top:6px">
        ${incoming ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Incoming goods</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5">${incoming}</div>
        </div>` : "<div></div>"}
        ${item.production_notes_po ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Production notes</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.production_notes_po}</div>
        </div>` : "<div></div>"}
        ${item.packing_notes ? `<div style="background:#f9f9f9;padding:4px 8px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Packing / shipping</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.packing_notes}</div>
        </div>` : "<div></div>"}
      </div>
    </div>`;
  }).join("");

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const shipDate = data.target_ship_date
    ? new Date(data.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : "—";

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>* { box-sizing: border-box; margin: 0; padding: 0; } body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <div style="display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:18px;border-bottom:2px solid #1a1a1a;margin-bottom:18px">
    <div>
      ${HPD_LOGO_SVG}
      <div style="font-size:11px;color:#666;line-height:1.7;margin-top:8px">
        3945 W Reno Ave, Ste A · Las Vegas, NV 89118<br/>jon@housepartydistro.com
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:20px;font-weight:800;letter-spacing:-0.5px;color:#1a1a1a">PO# ${data.job_number || "—"}</div>
      <div style="font-size:10px;color:#888;margin-top:4px">${data.client_name} · ${data.vendor_name}</div>
    </div>
  </div>

  <div style="display:flex;gap:0;border:0.5px solid #ccc;margin-bottom:16px">
    ${[["Date",today],["Ship date",shipDate],["Vendor ID",data.vendor_short_code||data.vendor_name],["Ship method",data.ship_method||"—"]].map(([k,v],i,arr)=>`<div style="flex:1;padding:5px 8px;${i<arr.length-1?"border-right:0.5px solid #ccc":""}"><div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div><div style="font-size:10px;font-weight:600;color:#1a1a1a">${v}</div></div>`).join("")}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px;font-size:10px">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Bill to</div>
      <div style="line-height:1.7">House Party Distro<br/>jon@housepartydistro.com<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118</div>
    </div>
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Ship to</div>
      <div style="line-height:1.7;white-space:pre-wrap">${data.ship_to_address || "\u2014"}</div>
    </div>
  </div>

  <div style="background:#222;color:#fff;padding:5px 10px;display:flex;gap:24px;font-size:9.5px;margin-bottom:20px">
    <div><span style="opacity:0.6;margin-right:4px;text-transform:uppercase;font-size:8.5px;letter-spacing:0.05em">Client</span>${data.client_name}</div>
    <div><span style="opacity:0.6;margin-right:4px;text-transform:uppercase;font-size:8.5px;letter-spacing:0.05em">Items</span>${data.items.length}</div>
    <div><span style="opacity:0.6;margin-right:4px;text-transform:uppercase;font-size:8.5px;letter-spacing:0.05em">Total units</span>${data.items.reduce((a: number, it: any) => a + it.totalQty, 0).toLocaleString()}</div>
  </div>

  ${itemBlocks}

  <div style="border-top:2px solid #1a1a1a;padding-top:12px;margin-bottom:24px;text-align:right">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:4px">PO Total — Decoration</div>
    <div style="font-size:24px;font-weight:800;letter-spacing:-0.5px;font-family:${mono}">${fmtD(grandTotal)}</div>
  </div>

  <div style="border-top:0.5px solid #ddd;padding-top:10px;font-size:7.5px;color:#aaa;line-height:1.6">
    <strong style="font-size:8px;font-weight:700;color:#888;display:block;margin-bottom:3px">House Party Distro Purchase Order Conditions</strong>
    House Party Distro must be notified of any blank shortages or discrepancies within 24 hours of receipt of goods. Outbound shipping is at the sole direction of House Party Distro. Packing lists and tracking numbers must be supplied to House Party Distro immediately after the order has shipped. House Party Distro must be invoiced for any charges within 30 days of the PO date.
  </div>

</div>
</body></html>`;
}

export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  // Auth check — logged-in users or internal server calls
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!internal) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { jobId } = params;
    const vendorFilter = req.nextUrl.searchParams.get("vendor") ?? null;

    // Load decorator pricing from DB
    await loadPrinters(supabase);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*, clients(name)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { data: items, error: itemsError } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(decoration_type, decorators(name))")
      .eq("job_id", jobId)
      .order("sort_order");

    if (itemsError) return NextResponse.json({ error: "Failed to fetch items", detail: itemsError?.message }, { status: 500 });

    // Fetch mockup thumbnails for each item
    const itemIds = (items || []).map((it: any) => it.id);
    const { data: mockupFiles } = await supabase
      .from("item_files")
      .select("item_id, drive_file_id")
      .in("item_id", itemIds)
      .eq("stage", "mockup")
      .order("created_at", { ascending: false });
    const mockupByItem: Record<string, string> = {};
    for (const f of (mockupFiles || [])) {
      if (!mockupByItem[f.item_id]) mockupByItem[f.item_id] = f.drive_file_id;
    }

    const costingData = job.costing_data || {};
    const costProds: any[] = costingData.costProds || [];

    // Sort by sort_order to match PO tab letter assignment
    const sortedItems = [...(items || [])].sort((a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0));

    const allMapped = sortedItems.map((it: any, sortedIdx: number) => {
      const qtys: Record<string, number> = {};
      for (const l of (it.buy_sheet_lines || [])) { qtys[l.size] = l.qty_ordered || 0; }
      const totalQty = Object.values(qtys).reduce((a: number, v: any) => a + v, 0);
      const assignment = it.decorator_assignments?.[0];
      const cp = costProds.find((p: any) => p.id === it.id);
      const decorator = assignment?.decorators;
      const decoLines = cp ? calcDecorationLines({ ...cp, totalQty }, costProds) : [];

      const mockupFileId = mockupByItem[it.id];
      return {
        id: it.id,
        name: it.name,
        blank_vendor: it.blank_vendor,
        blank_sku: it.blank_sku,
        drive_link: it.drive_link,
        mockupThumb: mockupFileId ? `https://lh3.googleusercontent.com/d/${mockupFileId}=w300` : null,
        incoming_goods: it.incoming_goods,
        production_notes_po: it.production_notes_po,
        packing_notes: it.packing_notes,
        decoration_type: assignment?.decoration_type,
        printVendor: cp?.printVendor || "",
        supplier: cp?.supplier || "",
        decorator,
        qtys,
        totalQty,
        decoLines,
        letter: String.fromCharCode(65 + sortedIdx), // letter based on full sorted list
      };
    });

    const mappedItems = allMapped.filter((it: any) => it.totalQty > 0);

    const vendorItems = vendorFilter
      ? mappedItems.filter((it: any) => it.printVendor === vendorFilter)
      : mappedItems;

    if (vendorItems.length === 0) return NextResponse.json({ error: "No items found for this vendor" }, { status: 404 });

    const firstDecorator = vendorItems.find((it: any) => it.decorator)?.decorator;
    const vendorName = vendorFilter || firstDecorator?.name || "Decorator";
    const orderInfo = costingData.orderInfo || {};

    const { data: decoratorRecord } = await supabase
      .from("decorators").select("*").ilike("name", vendorName).single()
      .then((r: any) => r).catch(() => ({ data: null, error: null }));

    const poData = {
      job_number: job.job_number,
      client_name: (job.clients as any)?.name || "—",
      target_ship_date: (() => {
        const ih = (job as any).type_meta?.in_hands_date || (job as any).type_meta?.show_date;
        if (ih) return calculateMilestones(ih).decoratorShips;
        return job.target_ship_date;
      })(),
      vendor_name: vendorName,
      vendor_short_code: (decoratorRecord as any)?.short_code || firstDecorator?.short_code || vendorName,
      vendor_email: (decoratorRecord as any)?.email || firstDecorator?.email || "",
      vendor_address: (decoratorRecord as any)?.address || firstDecorator?.address || "",
      vendor_city: (decoratorRecord as any)?.city || firstDecorator?.city || "",
      vendor_state: (decoratorRecord as any)?.state || firstDecorator?.state || "",
      vendor_zip: (decoratorRecord as any)?.zip || firstDecorator?.zip || "",
      payment_terms: (job.payment_terms || "").replace(/_/g, " "),
      ship_method: (job.type_meta as any)?.po_ship_methods?.[vendorName] || orderInfo.shipMethod || "",
      ship_to_address: (job.type_meta as any)?.venue_address || "",
      items: vendorItems,
    };

    const html = renderPOHTML(poData);
    const pdfBuffer = await generatePDF(html);

    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const vendorSlug = vendorName.replace(/\s+/g, "-");
    const filename = `HPD-PO-${job.job_number}-${vendorSlug}-${slug}.pdf`;

    const isDownload = req.nextUrl.searchParams.get("download");
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF PO Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
