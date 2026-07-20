import jsPDF from 'jspdf';
import { getLogoSvgForSlug } from '@/lib/branding-client';
import { MOCKUP_FRAME_ASPECT } from './mockup-crop';

// Bump whenever the PDF LAYOUT changes (not the data). The editor stamps this
// onto proof_spec when it bakes to Drive; on the next open, a Drive PDF baked
// with an older version is treated as stale and re-baked on exit — so a layout
// change reaches Drive without the user having to edit anything. v2 = document
// title/subtext header (was ITEM/BLANK boxes) + tag sizes as chips (2026-07-20).
// v3 = THE CURE: Browserless render of ProofDocBody replaces jsPDF (2026-07-20).
// v2 stamps were written by the retired jsPDF path — those Drive PDFs have the
// old layout (footer, bullet finishing), so they must re-bake once.
// v4 = print-fit pass: PDF-only stylesheet in lib/proof-html.ts (tighter
// spacing, 72% mockup, break rules) so typical proofs print on one Letter page.
export const PROOF_RENDERER_VERSION = 4;

// Inline size order for client-side sorting (mirrors lib/theme.ts SIZE_ORDER)
const SIZE_ORDER = [
  "OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL",
  "YXS","YS","YM","YL","YXL",
];
// Normalize PSD layer names: uppercase + common aliases (XXL→2XL, 2X→2XL, etc.)
function normalizeTagName(raw) {
  const u = (raw || '').toString().trim().toUpperCase();
  if (u === 'XXL' || u === '2X') return '2XL';
  if (u === 'XXXL' || u === '3X') return '3XL';
  if (u === 'XXXXL' || u === '4X') return '4XL';
  if (u === 'XXXXXL' || u === '5X') return '5XL';
  if (u === 'XXXXXXL' || u === '6X') return '6XL';
  return u;
}
function sortSizes(items) {
  return [...items].sort((a, b) => {
    const an = normalizeTagName(a.name);
    const bn = normalizeTagName(b.name);
    const ai = SIZE_ORDER.indexOf(an), bi = SIZE_ORDER.indexOf(bn);
    if (ai === -1 && bi === -1) return an.localeCompare(bn);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}


// Pre-load logo async. Per-tenant — call with the active company slug
// so the rasterized PNG matches the tenant. Cached by slug to avoid
// re-rasterizing on every proof.
const logoCache = {};
let lastPreloadedSlug = null;
export function preloadLogo(slug = "hpd") {
  return new Promise((resolve) => {
    if (logoCache[slug]) {
      lastPreloadedSlug = slug;
      resolve();
      return;
    }
    const svg = getLogoSvgForSlug(slug);
    if (!svg) { resolve(); return; }
    const svgBlob = new Blob([svg], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      // Render at 4x for crisp PDF embedding. Width/height derived from
      // the SVG's intrinsic ratio so per-tenant logos with different
      // viewBox shapes (HPD ~8:1, IHM ~2:1) don't get squashed.
      const scale = 4;
      const baseW = img.naturalWidth || 227;
      const baseH = img.naturalHeight || 29;
      const canvas = document.createElement('canvas');
      canvas.width = baseW * scale;
      canvas.height = baseH * scale;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      logoCache[slug] = {
        dataUrl: canvas.toDataURL('image/png'),
        ratio: baseW / baseH,
      };
      lastPreloadedSlug = slug;
      URL.revokeObjectURL(url);
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

function isLightColor(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

// Default summary-bar text — "2 locations · 6 colors · Piece Package…".
// Exported so the proof editor sidebar shows exactly the line the PDF
// will render when no custom summaryText override is set.
export function deriveProofSummary(printInfo, instructions) {
  const isTag = (p) => (p.placement || '').toLowerCase() === 'tag' || (p.placement || '').toLowerCase() === 'tags';
  const nonTagRows = (printInfo || []).filter(p => !isTag(p));
  const tagRows = (printInfo || []).filter(isTag);
  const totalLocations = nonTagRows.length;
  const totalColors = nonTagRows.reduce((a, p) => a + (p.colors?.length || 0), 0);
  const totalTags = tagRows.reduce((a, p) => a + (p.colors?.length || 0), 0);
  const summaryParts = [`${totalLocations} location${totalLocations !== 1 ? 's' : ''}`, `${totalColors} color${totalColors !== 1 ? 's' : ''}`];
  if (totalTags > 0) summaryParts.push(`${totalTags} size tag${totalTags !== 1 ? 's' : ''}`);
  const instrArr = Array.isArray(instructions) ? instructions : (instructions ? [instructions] : []);
  for (const instr of instrArr) { summaryParts.push(instr); }
  return summaryParts.join('\n');
}

// summaryText: undefined/null → auto-derive (deriveProofSummary);
// non-empty string → render as-is; empty string → omit the bar.
export function generateProofPdfClient({ mockupDataUrl, printInfo, clientName, itemName, blankVendor, blankStyle, blankColor, method, printType, instructions, notes, summaryText, finishing, addOns, fleece, colorCount, locationCount, disclaimer, tenantSlug, tenantName }) {
  const slug = tenantSlug || lastPreloadedSlug || "hpd";
  const cached = logoCache[slug];
  const tenantDisplayName = tenantName || (slug === "ihm" ? "In House Merchandise" : "House Party Distro");
  const tenantFooterLabel = tenantDisplayName.toUpperCase();
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = 612;
  const pageH = 792;
  const marginL = 36;
  const marginR = 36;
  const contentW = pageW - marginL - marginR;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const colorVal = blankStyle || blankColor;

  // ── Header ──
  let y = 28;

  // Logo — try preloaded PNG, fallback to text. Per-tenant height to
  // match the visual weight on Quote/Invoice/PO PDFs. Wide wordmarks
  // (HPD ~8:1) render tall enough at ~28pt; squarer marks (IHM ~2:1)
  // need ~52pt to avoid looking tiny. Width capped at 200pt so a long
  // wordmark doesn't crowd the "PRODUCT PROOF" title on the right.
  const ratio = cached?.ratio || 8;
  const logoH = cached ? (ratio >= 4 ? 28 : 52) : 0;
  if (cached?.dataUrl) {
    const logoW = Math.min(200, Math.round(logoH * ratio));
    doc.addImage(cached.dataUrl, 'PNG', marginL, y, logoW, logoH);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(26, 26, 26);
    doc.text(tenantDisplayName.toLowerCase(), marginL, y + 14);
  }

  // Document title + date (right side)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(26, 26, 26);
  doc.text('PRODUCT PROOF', pageW - marginR, y + 8, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(102, 102, 102);
  doc.text('Prepared for ' + (clientName || '—'), pageW - marginR, y + 24, { align: 'right' });

  // Header border — advance enough to clear both the logo and the
  // right-side title block. Date sits at y+24 plus a few pt of cap
  // height; tall logos (squarer ratios) push the bottom further.
  y += Math.max(34, logoH + 6);
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(3);
  doc.line(marginL, y, pageW - marginR, y);

  y += 4;

  // ── Meta strip (matches quote info bar) ──
  // \u2500\u2500 Shared helpers (mirror the web proof view) \u2500\u2500
  const footerH2 = 44;
  const needsNewPage = (needed) => y + needed > pageH - footerH2;
  const drawFooter = () => {
    let fy = pageH - 36;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(marginL, fy, pageW - marginR, fy);
    fy += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(150, 150, 150);
    doc.text(tenantFooterLabel, marginL, fy);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(150, 150, 150);
    doc.text('Date: ' + today, pageW - marginR, fy, { align: 'right' });
  };
  const labelRow = (txt, x, yy) => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(160, 160, 170);
    doc.text(String(txt).toUpperCase(), x, yy);
  };
  const sectionHead = (txt) => {
    doc.setDrawColor(26, 26, 26); doc.setLineWidth(1.5);
    doc.line(marginL, y, pageW - marginR, y);
    y += 14;
    labelRow(txt, marginL, y);
    y += 13;
  };
  const boxRow = (tiles, valueSize) => {
    const gap = 10;
    const tw = (contentW - gap * (tiles.length - 1)) / tiles.length;
    const wrap = tiles.map(([label, val], i) => {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(valueSize);
      const lines = doc.splitTextToSize(String(val), tw - 22).slice(0, 3);
      return { label, lines, x: marginL + i * (tw + gap) };
    });
    const maxL = Math.max(1, ...wrap.map(w => w.lines.length));
    const h = 22 + maxL * (valueSize + 2);
    if (needsNewPage(h + 4)) { drawFooter(); doc.addPage(); y = 36; }
    wrap.forEach(({ label, lines, x }) => {
      doc.setDrawColor(224, 224, 228); doc.setLineWidth(0.7);
      doc.roundedRect(x, y, tw, h, 6, 6, 'S');
      labelRow(label, x + 11, y + 14);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(valueSize); doc.setTextColor(26, 26, 26);
      lines.forEach((ln, li) => doc.text(ln, x + 11, y + 28 + li * (valueSize + 2)));
    });
    y += h + 14;
  };


  // \u2500\u2500 Item title + blank subtext \u2500 document style, mirrors the web
  //    proof (no ITEM/BLANK boxes): big title + "vendor \u00b7 color" subtext. \u2500\u2500
  {
    const subParts = [];
    if (blankVendor && blankVendor !== '\u2014') subParts.push(blankVendor);
    if (colorVal) subParts.push(colorVal);
    const blankSub = subParts.join(' \u00b7 ');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(26, 26, 26);
    const titleLines = doc.splitTextToSize(itemName || '\u2014', contentW);
    let by = y + 16;
    titleLines.forEach((ln, li) => { doc.text(ln, marginL, by); if (li < titleLines.length - 1) by += 22; });
    by += 8;
    if (blankSub) {
      by += 12;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5); doc.setTextColor(107, 107, 120);
      doc.text(blankSub, marginL, by);
    }
    y = by + 16;
  }
  // ── Mockup image ── (crop is pre-baked to a MOCKUP_FRAME_ASPECT canvas by the
  //    caller, so the PDF just places it in the matching frame; original file is
  //    never modified) ──
  if (mockupDataUrl) {
    const frameW = contentW * 0.74;
    const frameH = frameW / MOCKUP_FRAME_ASPECT;
    if (needsNewPage(frameH + 14)) { drawFooter(); doc.addPage(); y = 36; }
    const frameX = marginL + (contentW - frameW) / 2;
    try { doc.addImage(mockupDataUrl, 'JPEG', frameX, y, frameW, frameH); } catch (e) { /* skip on decode error */ }
    y += frameH + 14;
  }

  // ── Special Instructions notice (dark left accent, mirrors web) ──
  if (notes) {
    const noteLines = doc.splitTextToSize(notes, contentW - 28);
    const boxH = Math.max(34, noteLines.length * 12 + 26);
    if (needsNewPage(boxH + 14)) { drawFooter(); doc.addPage(); y = 36; }
    doc.setFillColor(244, 244, 245);
    doc.roundedRect(marginL, y, contentW, boxH, 4, 4, 'F');
    doc.setFillColor(26, 26, 26);
    doc.rect(marginL, y, 4, boxH, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); doc.setTextColor(26, 26, 26);
    doc.text('SPECIAL INSTRUCTIONS', marginL + 15, y + 14);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
    doc.text(noteLines, marginL + 15, y + 28);
    y += boxH + 14;
  }

  // -- Locations (per-print cards in a grid, mirrors the web proof) --
  if ((printInfo || []).length > 0) {
    if (needsNewPage(90)) { drawFooter(); doc.addPage(); y = 36; }
    sectionHead('Locations');

    const cols = Math.max(1, Math.min(3, Math.floor(contentW / 170)));
    const cgap = 10;
    const cardW = (contentW - cgap * (cols - 1)) / cols;

    // Measure (draw=false) or draw (draw=true) one card; returns its height.
    const renderCard = (p, cardX, cardTop, draw) => {
      const innerX = cardX + 12;
      const innerW = cardW - 24;
      const isTag = (p.placement || '').toLowerCase() === 'tag' || (p.placement || '').toLowerCase() === 'tags';
      const colors = isTag ? sortSizes(p.colors || []) : (p.colors || []);
      const sizeStr = p.sizeText ? p.sizeText : (p.widthInches && p.heightInches) ? (p.widthInches + '" × ' + p.heightInches + '"') : '—';
      const specialties = p.specialties || [];
      const chipH = 11, chipGapX = 8, chipGapY = 5;
      const chips = (startY, drawChips) => {
        let cx = innerX, cyy = startY, any = false;
        for (const c of colors) {
          any = true;
          const name = c.name || '—';
          doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
          const chipW = 10 + 4 + doc.getTextWidth(name);
          if (cx + chipW > innerX + innerW && cx > innerX) { cx = innerX; cyy += chipH + chipGapY; }
          if (drawChips) {
            const hex = (c.hex && /^#[0-9a-fA-F]{6}$/.test(c.hex)) ? c.hex : '#cfcfd4';
            const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
            doc.setFillColor(r, g, b); doc.setDrawColor(224, 224, 228); doc.setLineWidth(0.5);
            doc.roundedRect(cx, cyy - 7.5, 9, 9, 2, 2, 'FD');
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(26, 26, 26);
            doc.text(name, cx + 12, cyy);
          }
          cx += chipW + chipGapX;
        }
        return any ? cyy : startY;
      };

      const LBL_TO_VAL = 10, VAL_LINE = 11, VAL_TO_LBL = 14;
      let cy = cardTop + 13;
      // placement header + underline
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5);
      if (draw) { doc.setTextColor(26, 26, 26); doc.text(doc.splitTextToSize(p.placement || '—', innerW)[0], innerX, cy + 7); }
      cy += 12;
      if (draw) { doc.setDrawColor(238, 238, 238); doc.setLineWidth(0.5); doc.line(innerX, cy, cardX + cardW - 12, cy); }
      cy += 13;
      // print size
      if (draw) labelRow('Print size', innerX, cy);
      cy += LBL_TO_VAL;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
      const sizeLines = doc.splitTextToSize(sizeStr, innerW);
      if (draw) { doc.setTextColor(26, 26, 26); doc.text(sizeLines, innerX, cy); }
      cy += (sizeLines.length - 1) * VAL_LINE + VAL_TO_LBL;
      // Colors — chips for EVERY location including tags (a tag's "colors" are
      // its size names, each with an ink swatch). Mirrors the web proof exactly;
      // chips wrap within the card, so all sizes show without clipping.
      if (draw) labelRow('Colors', innerX, cy);
      cy += LBL_TO_VAL + 2;
      if (colors.length) { cy = chips(cy, draw); }
      else { if (draw) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(160, 160, 170); doc.text('—', innerX, cy); } }
      cy += VAL_TO_LBL;
      // placement callout
      if (p.callout) {
        if (draw) labelRow('Placement', innerX, cy);
        cy += LBL_TO_VAL;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
        const cl = doc.splitTextToSize(p.callout, innerW);
        if (draw) { doc.setTextColor(26, 26, 26); doc.text(cl, innerX, cy); }
        cy += (cl.length - 1) * VAL_LINE + VAL_TO_LBL;
      }
      // per-location add-ons
      if (specialties.length) {
        if (draw) labelRow('Add-ons', innerX, cy);
        cy += LBL_TO_VAL;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
        const al = doc.splitTextToSize(specialties.join(', '), innerW);
        if (draw) { doc.setTextColor(26, 26, 26); doc.text(al, innerX, cy); }
        cy += (al.length - 1) * VAL_LINE + VAL_TO_LBL;
      }
      return (cy - cardTop) - VAL_TO_LBL + 13;
    };

    // Place cards row by row; each row sizes to its tallest card.
    let idx = 0;
    while (idx < printInfo.length) {
      const row = printInfo.slice(idx, idx + cols);
      const heights = row.map(p => renderCard(p, marginL, 0, false));
      const rowH = Math.max.apply(null, heights);
      if (needsNewPage(rowH + 12)) { drawFooter(); doc.addPage(); y = 36; }
      row.forEach((p, ci) => {
        const x = marginL + ci * (cardW + cgap);
        doc.setDrawColor(224, 224, 228); doc.setLineWidth(0.8);
        doc.roundedRect(x, y, cardW, rowH, 8, 8, 'S');
        renderCard(p, x, y, true);
      });
      y += rowH + 12;
      idx += cols;
    }

    // Untagged add-ons -- active in Costing, not yet tagged to a location.
    if ((addOns || []).length) {
      if (needsNewPage(20 + addOns.length * 14)) { drawFooter(); doc.addPage(); y = 36; }
      labelRow('Add-ons', marginL, y + 4);
      y += 12;
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
      for (const s of addOns) {
        doc.setFillColor(26, 26, 26); doc.circle(marginL + 3, y + 3, 1.4, 'F');
        doc.text(s, marginL + 12, y + 6);
        y += 14;
      }
      y += 4;
    }
  }

  // -- Product spec (KPI tiles, mirrors web) --
  {
    const tiles = [
      ['Method', method || '—'],
      ['Type', printType || '—'],
      ['Locations', String(locationCount || 0)],
    ];
    if (fleece) tiles.push(['Fleece', 'Yes']);
    if (needsNewPage(70)) { drawFooter(); doc.addPage(); y = 36; }
    sectionHead('Product spec');
    boxRow(tiles, 14);
  }

  // -- Finishing & handling (2-column list, mirrors web) --
  if ((finishing || []).length) {
    if (needsNewPage(50)) { drawFooter(); doc.addPage(); y = 36; }
    sectionHead('Finishing & handling');
    const fcols = 2, fgap = 24;
    const fcolW = (contentW - fgap) / fcols;
    const half = Math.ceil(finishing.length / fcols);
    for (let r = 0; r < half; r++) {
      const left = finishing[r];
      const right = finishing[r + half];
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
      const ll = doc.splitTextToSize(left, fcolW - 16);
      const rl = right ? doc.splitTextToSize(right, fcolW - 16) : [];
      const rows = Math.max(ll.length, rl.length);
      if (needsNewPage(rows * 12 + 4)) { drawFooter(); doc.addPage(); y = 36; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(26, 26, 26);
      doc.setFillColor(26, 26, 26); doc.circle(marginL + 3, y + 3, 1.4, 'F');
      doc.text(ll, marginL + 12, y + 6);
      if (right) {
        const rx = marginL + fcolW + fgap;
        doc.setFillColor(26, 26, 26); doc.circle(rx + 3, y + 3, 1.4, 'F');
        doc.text(rl, rx + 12, y + 6);
      }
      y += rows * 12 + 6;
    }
    y += 4;
  }

  // -- Approval disclaimer --
  if (disclaimer) {
    if (needsNewPage(60)) { drawFooter(); doc.addPage(); y = 36; }
    sectionHead('Approval');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(107, 107, 120);
    const dl = doc.splitTextToSize(disclaimer, contentW);
    doc.text(dl, marginL, y + 6);
    y += dl.length * 11 + 8;
  }

  // ── Footer ──
  drawFooter();

  return doc;
}
