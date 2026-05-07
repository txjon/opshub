import jsPDF from 'jspdf';
import { getLogoSvgForSlug } from '@/lib/branding-client';

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

export function generateProofPdfClient({ mockupDataUrl, printInfo, clientName, itemName, blankVendor, blankStyle, blankColor, method, instructions, notes, tenantSlug, tenantName }) {
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
  const blankParts = [blankVendor]; const colorVal = blankStyle || blankColor; if (colorVal) blankParts.push(colorVal);
  const blankStr = blankParts.filter(Boolean).join(' \u2014 ') || '\u2014';

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
  doc.text('Date: ' + today, pageW - marginR, y + 24, { align: 'right' });

  // Header border — advance enough to clear both the logo and the
  // right-side title block. Date sits at y+24 plus a few pt of cap
  // height; tall logos (squarer ratios) push the bottom further.
  y += Math.max(34, logoH + 6);
  doc.setDrawColor(17, 17, 17);
  doc.setLineWidth(3);
  doc.line(marginL, y, pageW - marginR, y);

  y += 4;

  // ── Meta strip (matches quote info bar) ──
  const metaCols = [
    { label: 'CLIENT', value: clientName || '\u2014' },
    { label: 'ITEM', value: itemName || '\u2014' },
    { label: 'BLANK', value: blankStr },
    ...(method ? [{ label: 'METHOD', value: method }] : []),
  ];
  const colW = contentW / metaCols.length;
  const stripH = 28;

  metaCols.forEach((col, i) => {
    const x = marginL + i * colW;

    // Vertical divider between columns
    if (i > 0) {
      doc.setDrawColor(229, 231, 235);
      doc.setLineWidth(0.5);
      doc.line(x, y + 2, x, y + stripH - 2);
    }

    // Label
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(170, 170, 170);
    doc.text(col.label, x + (i === 0 ? 0 : 10), y + 10);

    // Value
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(26, 26, 26);
    const maxValW = colW - (i === 0 ? 10 : 20);
    const valLines = doc.splitTextToSize(col.value, maxValW);
    doc.text(valLines[0] || '', x + (i === 0 ? 0 : 10), y + 21);
  });

  // Strip bottom border
  y += stripH;
  doc.setDrawColor(229, 231, 235);
  doc.setLineWidth(0.5);
  doc.line(marginL, y, pageW - marginR, y);

  y += 12;

  // ── Mockup image ──
  if (mockupDataUrl) {
    let imgW = contentW * 0.65;
    let imgH = imgW / 2;
    try {
      const props = doc.getImageProperties(mockupDataUrl);
      if (props.width && props.height) {
        imgH = (props.height / props.width) * imgW;
        const maxH = 220;
        if (imgH > maxH) {
          imgH = maxH;
          imgW = (props.width / props.height) * imgH;
        }
      }
    } catch (e) { /* fallback */ }
    const imgX = marginL + (contentW - imgW) / 2;
    doc.addImage(mockupDataUrl, 'JPEG', imgX, y, imgW, imgH);
    y += imgH + 10;
  }

  // ── Print details table ──
  const footerH = 44;
  const needsNewPage = (needed) => y + needed > pageH - footerH;

  const drawFooter = () => {
    let fy = pageH - 36;
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(marginL, fy, pageW - marginR, fy);
    fy += 12;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(170, 170, 170);
    doc.text(tenantFooterLabel, marginL, fy);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(170, 170, 170);
    doc.text('Colors shown are approximate \u2014 refer to Pantone references for exact ink matching.', marginL, fy + 10);
  };

  if ((printInfo || []).length > 0) {
    if (needsNewPage(60)) { drawFooter(); doc.addPage(); y = 36; }

    // Table header — matches quote table th style
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(153, 153, 153);

    const col1X = marginL;
    const col2X = marginL + contentW * 0.38;
    const colEndX = pageW - marginR;

    doc.text('PRINT SIZE & PLACEMENT', col1X, y + 4);
    doc.text('COLORS', col2X, y + 4);

    // Table header border
    y += 8;
    doc.setDrawColor(26, 26, 26);
    doc.setLineWidth(1.5);
    doc.line(marginL, y, pageW - marginR, y);
    y += 4;

    // ── Print rows ──
    for (const p of (printInfo || [])) {
      // Freeform sizeText (manual input) wins; PSD-derived rows fall back
      // to the structured widthInches × heightInches format.
      const sizeStr = p.sizeText ? p.sizeText : (p.widthInches && p.heightInches) ? `${p.widthInches}" \u00D7 ${p.heightInches}"` : '\u2014';
      // Sort tag/size tag colors by canonical size order (S, M, L, XL, 2XL...)
      const isTagRow = (p.placement || '').toLowerCase() === 'tag' || (p.placement || '').toLowerCase() === 'tags';
      const sortedColors = isTagRow ? sortSizes(p.colors || []) : (p.colors || []);
      const colorNames = sortedColors.map(c => c.name).join(', ') || '\u2014';
      const colorCount = sortedColors.length;

      // Calculate row height
      let rowH = 20;
      if (sizeStr !== '\u2014') rowH += 10;
      if (p.callout) rowH += 10;
      if (colorCount > 0) rowH += 14;

      if (needsNewPage(rowH + 8)) { drawFooter(); doc.addPage(); y = 36; }

      // Placement name
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(26, 26, 26);
      doc.text(p.placement, col1X, y + 14);

      // Print size under placement
      let detailY = y + 14;
      if (sizeStr !== '\u2014') {
        detailY += 11;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(60, 60, 60);
        doc.text(sizeStr, col1X, detailY);
      }

      // Callout under size
      if (p.callout) {
        detailY += 10;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(136, 136, 136);
        doc.text(p.callout, col1X, detailY, { maxWidth: (col2X - col1X) - 8 });
      }

      // Color swatches — now have full width from col2X to colEndX
      if (colorCount > 0) {
        let swatchX = col2X;
        let swatchY = y + 5;
        for (const c of sortedColors) {
          // Hex may be undefined when colors come from manual entry —
          // fall back to a neutral gray pill rather than crashing.
          const hex = (c.hex && /^#[0-9a-fA-F]{6}$/.test(c.hex)) ? c.hex : '#cfcfd4';
          const light = isLightColor(hex);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(6.5);
          const textW = doc.getTextWidth(c.name);
          const pillW = textW + 10;
          const pillH = 11;

          const r = parseInt(hex.slice(1, 3), 16);
          const g = parseInt(hex.slice(3, 5), 16);
          const b = parseInt(hex.slice(5, 7), 16);
          doc.setFillColor(r, g, b);
          doc.roundedRect(swatchX, swatchY, pillW, pillH, 5, 5, 'F');

          if (light) {
            doc.setDrawColor(190, 190, 200);
            doc.setLineWidth(0.5);
            doc.roundedRect(swatchX, swatchY, pillW, pillH, 5, 5, 'S');
          }

          doc.setTextColor(light ? 40 : 255, light ? 40 : 255, light ? 40 : 255);
          doc.text(c.name, swatchX + pillW / 2, swatchY + pillH / 2 + 2, { align: 'center' });

          swatchX += pillW + 3;
          // Wrap to next line — now uses full width to colEndX
          if (swatchX + 40 > colEndX) {
            swatchX = col2X;
            swatchY += pillH + 2;
            rowH += pillH + 2;
          }
        }
      } else {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(102, 102, 102);
        doc.text(colorNames, col2X, y + 14);
      }

      // Row bottom border
      y += rowH;
      doc.setDrawColor(238, 238, 238);
      doc.setLineWidth(0.5);
      doc.line(marginL, y, pageW - marginR, y);
      y += 3;
    }

    // Summary line below table
    y += 4;
    const nonTagRows = (printInfo || []).filter(p => !((p.placement || '').toLowerCase() === 'tag' || (p.placement || '').toLowerCase() === 'tags'));
    const tagRows = (printInfo || []).filter(p => (p.placement || '').toLowerCase() === 'tag' || (p.placement || '').toLowerCase() === 'tags');
    const totalLocations = nonTagRows.length;
    const totalColors = nonTagRows.reduce((a, p) => a + (p.colors?.length || 0), 0);
    const totalTags = tagRows.reduce((a, p) => a + (p.colors?.length || 0), 0);

    // Table bottom border
    doc.setDrawColor(26, 26, 26);
    doc.setLineWidth(1.5);
    doc.line(marginL, y - 3, pageW - marginR, y - 3);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(26, 26, 26);
    const summaryParts = [`${totalLocations} location${totalLocations !== 1 ? 's' : ''}`, `${totalColors} color${totalColors !== 1 ? 's' : ''}`];
    if (totalTags > 0) summaryParts.push(`${totalTags} size tag${totalTags !== 1 ? 's' : ''}`);
    const instrArr = Array.isArray(instructions) ? instructions : (instructions ? [instructions] : []);
    for (const instr of instrArr) { summaryParts.push(instr); }
    doc.text(summaryParts.join('  \u00B7  '), pageW / 2, y + 12, { align: 'center' });

    y += 20;
  }

  // ── Notes section — only typed notes, no pre-set buttons ──
  if (notes) {
    if (needsNewPage(50)) { drawFooter(); doc.addPage(); y = 36; }

    doc.setFillColor(249, 249, 249);
    const noteLines = doc.splitTextToSize(notes, contentW - 20);
    const boxH = Math.max(32, noteLines.length * 11 + 22);
    doc.roundedRect(marginL, y, contentW, boxH, 5, 5, 'F');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6);
    doc.setTextColor(170, 170, 170);
    doc.text('NOTES', marginL + 10, y + 11);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(85, 85, 85);
    doc.text(noteLines, marginL + 10, y + 22);

    y += boxH + 8;
  }

  // ── Footer ──
  drawFooter();

  return doc;
}
