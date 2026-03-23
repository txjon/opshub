export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { generatePDF } from "@/lib/pdf/browser";

const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
  const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
  if (ai === -1 && bi === -1) return a.localeCompare(b);
  if (ai === -1) return 1; if (bi === -1) return -1;
  return ai - bi;
});
const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── Pricing tables (mirrored from CostingTab) ────────────────────────────────
const PRINTERS: Record<string, any> = {
  "STOKED": { qtys:[48,72,101,144,221,300,400,500,750,1000,2000,2500,5000,10000], prices:{1:[1.75,1.27,1.14,0.93,0.86,0.74,0.72,0.70,0.68,0.58,0.58,0.55,0.51,0.51],2:[2.51,1.84,1.63,1.23,1.14,0.94,0.91,0.83,0.81,0.69,0.67,0.56,0.51,0.51],3:[3.27,2.42,2.15,1.54,1.41,1.14,1.08,0.98,0.94,0.79,0.77,0.57,0.51,0.51],4:[4.03,2.99,2.65,1.86,1.69,1.34,1.27,1.12,1.07,0.89,0.87,0.58,0.54,0.53],5:[4.80,3.58,3.17,2.15,1.96,1.50,1.42,1.26,1.21,0.99,0.97,0.59,0.54,0.54],6:[6.02,4.50,4.02,2.64,2.41,1.81,1.72,1.51,1.45,1.18,1.15,0.64,0.56,0.56],7:[6.59,4.98,4.42,2.82,2.55,1.93,1.82,1.61,1.54,1.23,1.20,0.64,0.57,0.56],8:[7.09,5.31,4.69,3.07,2.78,2.06,1.94,1.69,1.61,1.30,1.26,0.65,0.57,0.56],9:[8.49,5.87,5.18,3.37,3.04,2.25,2.12,1.82,1.74,1.40,1.35,0.66,0.57,0.57],10:[9.88,6.44,5.68,3.72,3.36,2.44,2.30,1.97,1.86,1.50,1.45,0.66,0.58,0.57],11:[11.26,7.00,6.18,4.08,3.68,2.62,2.47,2.12,2.01,1.60,1.54,0.74,0.65,0.64],12:[12.50,7.46,6.56,4.68,4.25,2.82,2.65,2.26,2.14,1.70,1.64,0.76,0.65,0.64]}, tagPrices:[0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55], finishing:{Tee:0.55,Longsleeve:0.55,Fleece:0.55}, setup:{Screens:0,TagScreens:0,Seps:20,InkChange:15}, specialty:{HangTag:0.25,HemTag:0.50,Applique:0.75,WaterBase:0.35,Glow:0.30,Shimmer:0.25,Metallic:0.75,Puff:0.50,HighDensity:0.50,Reflective:0.40,Foil:1.50} },
  "TEELAND": { qtys:[48,72,101,144,221,300,400,500,750,1000,2000,2500,5000,10000], prices:{1:[1.75,1.27,1.14,0.93,0.86,0.74,0.72,0.70,0.68,0.58,0.58,0.55,0.51,0.51],2:[2.51,1.84,1.63,1.23,1.14,0.94,0.91,0.83,0.81,0.69,0.67,0.56,0.51,0.51],3:[3.27,2.42,2.15,1.54,1.41,1.14,1.08,0.98,0.94,0.79,0.77,0.57,0.51,0.51],4:[4.03,2.99,2.65,1.86,1.69,1.34,1.27,1.12,1.07,0.89,0.87,0.58,0.54,0.53],5:[4.80,3.58,3.17,2.15,1.96,1.50,1.42,1.26,1.21,0.99,0.97,0.59,0.54,0.54],6:[6.02,4.50,4.02,2.64,2.41,1.81,1.72,1.51,1.45,1.18,1.15,0.64,0.56,0.56]}, tagPrices:[0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55,0.55], finishing:{Tee:0.55,Longsleeve:0.55,Fleece:0.55}, setup:{Screens:0,TagScreens:0,Seps:20,InkChange:15}, specialty:{HangTag:0.25,HemTag:0.50,Applique:0.75,WaterBase:0.35,Glow:0.30,Shimmer:0.25,Metallic:0.75,Puff:0.50,HighDensity:0.50,Reflective:0.40,Foil:1.50} },
  "ICON": { qtys:[96,144,216,288,500,1000,3000], prices:{1:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],2:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],3:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],4:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],5:[1.10,1.00,1.00,0.85,0.75,0.65,0.60],6:[1.10,1.00,1.00,0.85,0.75,0.65,0.60]}, tagPrices:[0.50,0.50,0.50,0.45,0.45,0.40,0.40], finishing:{Tee:0.40,Longsleeve:0.50,Fleece:0.50}, setup:{Screens:20,TagScreens:10,Seps:20,InkChange:20}, specialty:{HangTag:0.10,HemTag:0.30,Applique:0.50,WaterBase:0.10,Glow:0.80,Shimmer:0.60,Metallic:0.60,Puff:0.75,HighDensity:0.65,Reflective:0.80,Foil:1.25} },
  "PACIFIC": { qtys:[96,144,216,288,500,1000,3000], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{} },
  "TEELAND EMB": { qtys:[96,144,216,288,500,1000,3000], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{} },
  "SHARON": { qtys:[96,144,216,288,500,1000,3000], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{} },
  "MERCH BROS": { qtys:[96,144,216,288,500,1000,3000], prices:{}, tagPrices:[], finishing:{}, setup:{Screens:0,TagScreens:0,Seps:0,InkChange:0}, specialty:{} },
};

function getPrintRate(pr: any, qty: number, colors: number): number {
  if (!pr?.qtys || !pr?.prices) return 0;
  const c = Math.min(Math.max(colors, 1), 12);
  const tiers = pr.qtys;
  let idx = tiers.length - 1;
  for (let i = 0; i < tiers.length; i++) { if (qty < tiers[i]) { idx = Math.max(0, i - 1); break; } }
  return pr.prices[c]?.[idx] || 0;
}

function calcDecorationLines(p: any): { label: string; qty: number; rate: number; total: number }[] {
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

  for (const loc of activeLocs) {
    const ld = p.printLocations[loc];
    if (!ld?.location && !ld?.screens) continue;
    const screens = parseFloat(ld.screens) || 0;
    if (screens === 0) continue;
    const rate = getPrintRate(pr, qty, screens);
    lines.push({ label: ld.location || `Location ${loc}`, qty, rate, total: rate * qty });
  }

  // Tag print
  if (p.tagPrint) {
    const tagRate = pr.tagPrices?.[pr.qtys?.findIndex((q: number) => qty < q) - 1 || 0] || 0;
    lines.push({ label: "Tag print", qty, rate: tagRate, total: tagRate * qty });
  }

  // Finishing
  if (p.finishingQtys && activeLocs.length > 0) {
    const locsCount = activeLocs.length + (p.tagPrint ? 1 : 0);
    if (p.finishingQtys["Packaging_on"]) {
      const variant = p.isFleece ? "Fleece" : (p.finishingQtys["Packaging_variant"] || "Tee");
      const rate = pr.finishing?.[variant] || 0;
      lines.push({ label: `Packaging (${variant})`, qty, rate, total: rate * qty });
    }
    if (p.finishingQtys["HangTag_on"]) {
      const rate = pr.specialty?.HangTag || 0;
      lines.push({ label: "Hang tag", qty, rate, total: rate * qty });
    }
    if (p.finishingQtys["HemTag_on"]) {
      const rate = pr.specialty?.HemTag || 0;
      lines.push({ label: "Hem tag", qty, rate, total: rate * qty });
    }
    if (p.finishingQtys["Applique_on"]) {
      const rate = pr.specialty?.Applique || 0;
      lines.push({ label: "Appliqué", qty, rate, total: rate * qty });
    }
    if (p.isFleece) {
      const rate = (pr.finishing?.Tee || 0) * locsCount;
      lines.push({ label: "Fleece upcharge", qty, rate, total: rate * qty });
    }
  }

  // Specialty
  if (p.specialtyQtys && activeLocs.length > 0) {
    const specKeys = ["WaterBase","Glow","Shimmer","Metallic","Puff","HighDensity","Reflective","Foil"];
    for (const key of specKeys) {
      if (p.specialtyQtys[key + "_on"]) {
        const rate = (pr.specialty?.[key] || 0) * activeLocs.length;
        lines.push({ label: key.replace(/([A-Z])/g, " $1").trim(), qty, rate, total: rate * qty });
      }
    }
  }

  // Setup fees (one-time)
  if (p.setupFees) {
    const autoScreens = [1,2,3,4,5,6].reduce((a: number, loc: number) => a + (parseFloat(p.printLocations?.[loc]?.screens) || 0), 0);
    if (pr.setup.Screens > 0 && autoScreens > 0) {
      lines.push({ label: `Screen fees (${autoScreens} screens)`, qty: autoScreens, rate: pr.setup.Screens, total: pr.setup.Screens * autoScreens });
    }
    if (!p.tagRepeat && pr.setup.TagScreens > 0 && p.tagPrint) {
      const activeSizes = (p.sizes || []).filter((sz: string) => (p.qtys?.[sz] || 0) > 0).length;
      const tagSizes = activeSizes || p.setupFees.tagSizes || 0;
      if (tagSizes > 0) lines.push({ label: `Tag screen fees (${tagSizes} sizes)`, qty: tagSizes, rate: pr.setup.TagScreens, total: pr.setup.TagScreens * tagSizes });
    }
    if (pr.setup.Seps > 0 && p.setupFees.seps > 0) {
      lines.push({ label: `Separations (${p.setupFees.seps})`, qty: p.setupFees.seps, rate: pr.setup.Seps, total: pr.setup.Seps * p.setupFees.seps });
    }
    if (pr.setup.InkChange > 0 && p.setupFees.inkChanges > 0) {
      lines.push({ label: `Ink changes (${p.setupFees.inkChanges})`, qty: p.setupFees.inkChanges, rate: pr.setup.InkChange, total: pr.setup.InkChange * p.setupFees.inkChanges });
    }
    if (p.setupFees.manualCost > 0) {
      lines.push({ label: "Setup (manual)", qty: 1, rate: p.setupFees.manualCost, total: p.setupFees.manualCost });
    }
  }

  // Custom costs
  for (const c of (p.customCosts || [])) {
    if (c.amount) lines.push({ label: c.label || "Custom", qty: 1, rate: c.amount, total: c.amount });
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
      <div style="margin-top:10px;border-top:0.5px solid #e8e8e8;padding-top:8px">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Print & Decoration</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          ${decoLines.map((l: any) => `
            <tr>
              <td style="padding:3px 0;color:#444">${l.label}</td>
              <td style="padding:3px 8px;text-align:right;color:#888;font-family:${mono}">${l.qty.toLocaleString()}×${fmtD(l.rate)}</td>
              <td style="padding:3px 0;text-align:right;font-weight:700;font-family:${mono}">${fmtD(l.total)}</td>
            </tr>`).join("")}
          <tr style="border-top:0.5px solid #e0e0e0">
            <td colspan="2" style="padding:5px 0 2px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:#888">Item total</td>
            <td style="padding:5px 0 2px;text-align:right;font-size:12px;font-weight:800;font-family:${mono}">${fmtD(itemTotal)}</td>
          </tr>
        </table>
      </div>` : "";

    return `<div style="border-left:3px solid #1a1a1a;padding-left:16px;margin-bottom:24px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div style="font-size:13px;font-weight:700">${item.letter} — ${item.name}</div>
        <div style="font-size:10px;color:#888">${item.totalQty.toLocaleString()} units</div>
      </div>
      <div style="display:flex;gap:16px;margin-bottom:8px;font-size:10px;color:#555">
        ${item.blank_vendor ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Brand</span>${item.blank_vendor}</div>` : ""}
        ${item.blank_sku ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Color</span>${item.blank_sku}</div>` : ""}
        ${item.printVendor ? `<div><span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#bbb;margin-right:4px">Decorator</span>${item.printVendor}</div>` : ""}
      </div>
      ${sizeStr ? `<div style="font-size:10px;color:#555;padding:5px 10px;background:#f7f7f7;border-radius:3px;margin-bottom:8px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#aaa;margin-right:6px">Sizes</span>${sizeStr}
      </div>` : ""}
      ${item.drive_link ? `<div style="font-size:9.5px;margin-bottom:10px;padding:4px 10px;background:#f0f5ff;border-radius:3px">
        <span style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#888;margin-right:6px">Production files</span>
        <a href="${item.drive_link}" style="color:#1a56db">${item.drive_link}</a>
      </div>` : ""}
      ${decoSection}
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:10px">
        ${incoming ? `<div style="background:#f9f9f9;padding:7px 10px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Incoming goods</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5">${incoming}</div>
        </div>` : "<div></div>"}
        ${item.production_notes_po ? `<div style="background:#f9f9f9;padding:7px 10px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Production notes</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.production_notes_po}</div>
        </div>` : "<div></div>"}
        ${item.packing_notes ? `<div style="background:#f9f9f9;padding:7px 10px;border-radius:3px">
          <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;margin-bottom:3px">Packing / shipping</div>
          <div style="font-size:9.5px;color:#444;line-height:1.5;white-space:pre-wrap">${item.packing_notes}</div>
        </div>` : "<div></div>"}
      </div>
    </div>`;
  }).join("");

  const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  const shipDate = data.target_ship_date
    ? new Date(data.target_ship_date).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
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
    ${[["Date",today],["Ship date",shipDate],["Vendor ID",data.vendor_short_code||data.vendor_name],["Ship method",data.ship_method||"—"],["Ship acct.",data.ship_account||"—"]].map(([k,v],i,arr)=>`<div style="flex:1;padding:5px 8px;${i<arr.length-1?"border-right:0.5px solid #ccc":""}"><div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div><div style="font-size:10px;font-weight:600;color:#1a1a1a">${v}</div></div>`).join("")}
  </div>

  <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:16px;font-size:10px">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Bill to</div>
      <div style="line-height:1.7">House Party Distro<br/>jon@housepartydistro.com<br/>3945 W Reno Ave, Ste A<br/>Las Vegas, NV 89118</div>
    </div>
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Ship to / Decorator</div>
      <div style="line-height:1.7">
        ${data.vendor_name}
        ${data.vendor_email ? `<br/>${data.vendor_email}` : ""}
        ${data.vendor_address ? `<br/>${data.vendor_address}` : ""}
        ${data.vendor_city ? `<br/>${[data.vendor_city,data.vendor_state,data.vendor_zip].filter(Boolean).join(", ")}` : ""}
      </div>
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
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { jobId } = params;
    const vendorFilter = req.nextUrl.searchParams.get("vendor") ?? null;

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
      const decoLines = cp ? calcDecorationLines({ ...cp, totalQty }) : [];

      return {
        id: it.id,
        name: it.name,
        blank_vendor: it.blank_vendor,
        blank_sku: it.blank_sku,
        drive_link: it.drive_link,
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
      target_ship_date: job.target_ship_date,
      vendor_name: vendorName,
      vendor_short_code: (decoratorRecord as any)?.short_code || firstDecorator?.short_code || vendorName,
      vendor_email: (decoratorRecord as any)?.email || firstDecorator?.email || "",
      vendor_address: (decoratorRecord as any)?.address || firstDecorator?.address || "",
      vendor_city: (decoratorRecord as any)?.city || firstDecorator?.city || "",
      vendor_state: (decoratorRecord as any)?.state || firstDecorator?.state || "",
      vendor_zip: (decoratorRecord as any)?.zip || firstDecorator?.zip || "",
      ship_method: orderInfo.shipMethod || "",
      ship_account: "",
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
