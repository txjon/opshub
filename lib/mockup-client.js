import { readPsd } from 'ag-psd';

// Placement zones (template pixel coords at 40 DPI)
const ZONES = {
  'Full Front': { centerX: 680, top: 351, maxW: 568, maxH: 726 },
  'Left Chest': { centerX: 833, top: 392, maxW: 164, maxH: 165 },
  'Full Back':  { centerX: 2107, top: 308, maxW: 568, maxH: 726 },
};

// Extended placement map used by the proof-info extractor. Superset of
// the mockup compositor's ZONES — unmapped group names pass through
// with their original name (e.g. "Right Sleeve") so the proof shows
// the real placement even when the mockup template doesn't composite
// that zone.
export const PLACEMENT_MAP = {
  'Front':        'Full Front',
  'Full Front':   'Full Front',
  'Back':         'Full Back',
  'Full Back':    'Full Back',
  'Left Chest':   'Left Chest',
  'Right Chest':  'Right Chest',
  'Left Sleeve':  'Left Sleeve',
  'Right Sleeve': 'Right Sleeve',
  'Neck':         'Neck',
  'Hood':         'Hood',
  'Pocket':       'Pocket',
};

// Groups that aren't print-art (template scaffolding / auto-added
// helpers in the source PSD).
export const SKIP_GROUPS = ['Shirt Color', 'Shadows', 'Highlights', 'Mask', 'Client Art'];

// Layer names that are template helpers, not real separations. "Base"
// is intentionally NOT here — Base is a real white underlayer pull
// that belongs on the proof as its own separation.
export const NON_INK_NAMES = new Set([
  'reference', 'guide', 'guides', 'template', 'preview',
  'composite', 'bg', 'background', 'blank',
]);

const DPI_SCALE = 40 / 300;

// Cache the parsed template PSD
let cachedTemplate = null;

async function loadTemplate() {
  if (cachedTemplate) return cachedTemplate;
  const res = await fetch('/templates/Tee Mockup Template.psd');
  if (!res.ok) throw new Error(`Template load failed: ${res.status}`);
  const buffer = await res.arrayBuffer();
  cachedTemplate = readPsd(new Uint8Array(buffer));
  return cachedTemplate;
}

// Pre-fetch template so first mockup is instant
export function preloadTemplate() {
  loadTemplate().catch(() => {});
}

export function sampleLayerColor(canvas) {
  if (!canvas) return '#888888';
  const ctx = canvas.getContext('2d');
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let rSum = 0, gSum = 0, bSum = 0, count = 0;
  for (let i = 0; i < data.length; i += 40) {
    if (data[i + 3] > 128) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count++;
    }
  }
  if (count === 0) return '#888888';
  const r = Math.round(rSum / count).toString(16).padStart(2, '0');
  const g = Math.round(gSum / count).toString(16).padStart(2, '0');
  const b = Math.round(bSum / count).toString(16).padStart(2, '0');
  return '#' + r + g + b;
}

// Single source of truth for turning a parsed PSD into per-location
// print-info entries that feed the proof PDF + Art Studio UI. Same
// rules as Photoshop's "group size" readout:
//   Bounds — only real-ink layers (visible + rendered canvas + not a
//            template helper). Blank Pantone-callout layers and hidden
//            reference layers are excluded so they don't inflate the
//            reported size past what Photoshop shows.
//   Colors — every visible layer that isn't a template helper. That
//            includes Base (rendered white), every ink layer, AND
//            blank Pantone-callout layers (gray swatch, name only)
//            so the printer still sees them.
export function extractPrintInfoFromPsd(psd) {
  const info = [];
  if (!psd || !Array.isArray(psd.children)) return info;
  // Reverse to match Photoshop panel order: top-of-panel first.
  const groups = [...psd.children].reverse();
  for (const group of groups) {
    if (!group || SKIP_GROUPS.includes(group.name)) continue;
    const name = group.name || '';
    const isTag = name.toLowerCase() === 'tag' || name.toLowerCase() === 'tags';
    if (!isTag && (!group.children || group.children.length === 0)) continue;

    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    const colors = [];

    for (const layer of (group.children || [])) {
      const ln = (layer.name || '').toLowerCase().trim();
      const isBase = ln === 'base';
      const isHidden = layer.hidden === true;
      const isNonInk = NON_INK_NAMES.has(ln);
      const isBlank = !layer.canvas;
      const excludeFromBounds = isHidden || isNonInk || isBlank;

      if (isTag) {
        // Tag groups: one representative bounding box (first non-excluded layer).
        if (!excludeFromBounds && minL === Infinity) {
          minL = layer.left || 0;
          minT = layer.top || 0;
          maxR = layer.right || 0;
          maxB = layer.bottom || 0;
        }
      } else if (!excludeFromBounds) {
        minL = Math.min(minL, layer.left || 0);
        minT = Math.min(minT, layer.top || 0);
        maxR = Math.max(maxR, layer.right || 0);
        maxB = Math.max(maxB, layer.bottom || 0);
      }

      if (!isHidden && !isNonInk) {
        let hex;
        if (isBase) hex = '#ffffff';
        else hex = sampleLayerColor(layer.canvas);
        colors.push({ name: layer.name, hex });
      }
    }

    const artW = maxR - minL;
    const artH = maxB - minT;
    if (artW <= 0 || artH <= 0) continue;

    info.push({
      placement: PLACEMENT_MAP[name] || name,
      groupName: name,
      widthInches: (artW / 300).toFixed(2),
      heightInches: (artH / 300).toFixed(2),
      colors,
      bounds: { minL, minT, maxR, maxB, artW, artH },
    });
  }
  return info;
}

export async function buildMockupClient(psdArrayBuffer) {
  const printPsd = readPsd(new Uint8Array(psdArrayBuffer));
  const templatePsd = await loadTemplate();

  const canvas = document.createElement('canvas');
  canvas.width = templatePsd.width;
  canvas.height = templatePsd.height;
  const ctx = canvas.getContext('2d');

  // 1. Shirt color from print PSD
  const shirtColorLayer = printPsd.children.find(l => l.name === 'Shirt Color');
  if (shirtColorLayer && shirtColorLayer.canvas) {
    ctx.drawImage(shirtColorLayer.canvas, 0, 0, shirtColorLayer.canvas.width, shirtColorLayer.canvas.height, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // 2. Build printInfo (shared extractor) and composite any groups
  // whose placement has a corresponding ZONE in the mockup template.
  const printInfo = extractPrintInfoFromPsd(printPsd);
  const groupByName = new Map();
  for (const g of (printPsd.children || [])) { if (g?.name) groupByName.set(g.name, g); }
  for (const info of printInfo) {
    const zone = ZONES[info.placement];
    if (!zone) continue;
    const group = groupByName.get(info.groupName);
    if (!group) continue;
    const { minL, minT, artW, artH } = info.bounds;
    const artCanvas = document.createElement('canvas');
    artCanvas.width = artW;
    artCanvas.height = artH;
    const artCtx = artCanvas.getContext('2d');
    for (const layer of (group.children || [])) {
      if (layer.canvas) artCtx.drawImage(layer.canvas, layer.left - minL, layer.top - minT);
    }
    const scaledW = Math.round(artW * DPI_SCALE);
    const scaledH = Math.round(artH * DPI_SCALE);
    const drawX = Math.round(zone.centerX - scaledW / 2);
    const drawY = zone.top;
    ctx.drawImage(artCanvas, 0, 0, artW, artH, drawX, drawY, scaledW, scaledH);
  }

  // 3-4. Shadows (multiply) and highlights (screen) via pixel blending
  const shadows = templatePsd.children.find(l => l.name === 'Shadows');
  const highlights = templatePsd.children.find(l => l.name === 'Highlights');

  if (shadows || highlights) {
    const baseData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const base = baseData.data;

    if (shadows && shadows.canvas) {
      const sCtx = shadows.canvas.getContext('2d');
      const sData = sCtx.getImageData(0, 0, shadows.canvas.width, shadows.canvas.height).data;
      const ox = shadows.left, oy = shadows.top;
      const sOp = shadows.opacity ?? 1;
      for (let sy = 0; sy < shadows.canvas.height; sy++) {
        const dy = sy + oy;
        if (dy < 0 || dy >= canvas.height) continue;
        for (let sx = 0; sx < shadows.canvas.width; sx++) {
          const dx = sx + ox;
          if (dx < 0 || dx >= canvas.width) continue;
          const si = (sy * shadows.canvas.width + sx) * 4;
          const di = (dy * canvas.width + dx) * 4;
          const sa = (sData[si + 3] / 255) * sOp;
          if (sa === 0) continue;
          for (let c = 0; c < 3; c++) {
            const blended = (base[di + c] * sData[si + c]) / 255;
            base[di + c] = Math.round(base[di + c] * (1 - sa) + blended * sa);
          }
        }
      }
    }

    if (highlights && highlights.canvas) {
      const hCtx = highlights.canvas.getContext('2d');
      const hData = hCtx.getImageData(0, 0, highlights.canvas.width, highlights.canvas.height).data;
      const ox = highlights.left, oy = highlights.top;
      const hOp = highlights.opacity ?? 1;
      for (let hy = 0; hy < highlights.canvas.height; hy++) {
        const dy = hy + oy;
        if (dy < 0 || dy >= canvas.height) continue;
        for (let hx = 0; hx < highlights.canvas.width; hx++) {
          const dx = hx + ox;
          if (dx < 0 || dx >= canvas.width) continue;
          const hi = (hy * highlights.canvas.width + hx) * 4;
          const di = (dy * canvas.width + dx) * 4;
          const ha = (hData[hi + 3] / 255) * hOp;
          if (ha === 0) continue;
          for (let c = 0; c < 3; c++) {
            const blended = 255 - ((255 - base[di + c]) * (255 - hData[hi + c])) / 255;
            base[di + c] = Math.round(base[di + c] * (1 - ha) + blended * ha);
          }
        }
      }
    }

    ctx.putImageData(baseData, 0, 0);
  }

  // 5. Clip to garment shape (invert mask)
  const mask = templatePsd.children.find(l => l.name === 'Mask');
  if (mask && mask.canvas) {
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    const maskCtx = maskCanvas.getContext('2d');
    maskCtx.drawImage(mask.canvas, mask.left, mask.top);

    const maskData = maskCtx.getImageData(0, 0, canvas.width, canvas.height);
    const md = maskData.data;
    for (let i = 3; i < md.length; i += 4) {
      md[i] = 255 - md[i];
    }
    maskCtx.putImageData(maskData, 0, 0);

    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(maskCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // Full size data URL for display + PDF
  const dataUrl = canvas.toDataURL('image/png');
  const mockupBase64 = dataUrl.split(',')[1];

  // JPEG with white background for Drive upload
  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.width = canvas.width;
  uploadCanvas.height = canvas.height;
  const uploadCtx = uploadCanvas.getContext('2d');
  uploadCtx.fillStyle = '#ffffff';
  uploadCtx.fillRect(0, 0, uploadCanvas.width, uploadCanvas.height);
  uploadCtx.drawImage(canvas, 0, 0);
  const uploadDataUrl = uploadCanvas.toDataURL('image/jpeg', 0.85);

  return { mockupBase64, dataUrl, uploadDataUrl, printInfo };
}
