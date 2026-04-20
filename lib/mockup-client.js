import { readPsd } from 'ag-psd';

// Placement zones (template pixel coords at 40 DPI)
const ZONES = {
  'Full Front': { centerX: 680, top: 351, maxW: 568, maxH: 726 },
  'Left Chest': { centerX: 833, top: 392, maxW: 164, maxH: 165 },
  'Full Back':  { centerX: 2107, top: 308, maxW: 568, maxH: 726 },
};

const PLACEMENT_MAP = {
  'Front':      'Full Front',
  'Full Front': 'Full Front',
  'Back':       'Full Back',
  'Full Back':  'Full Back',
  'Left Chest': 'Left Chest',
};

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

function sampleLayerColor(canvas) {
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

  // 2. Place print art (reverse to match Photoshop panel order: top-of-panel first)
  const printInfo = [];
  const SKIP_GROUPS = ['Shirt Color', 'Shadows', 'Highlights', 'Mask'];
  // Layer names that should never affect printed-size math (reference/template/base/etc.)
  const NON_INK_NAMES = new Set(["base","reference","guide","guides","template","preview","composite","bg","background","blank"]);
  const groups = [...printPsd.children].reverse();
  for (const group of groups) {
    if (!group.children) continue;
    if (SKIP_GROUPS.includes(group.name)) continue;

    const zoneName = PLACEMENT_MAP[group.name];
    const colors = [];

    const isTag = group.name.toLowerCase() === 'tag' || group.name.toLowerCase() === 'tags';
    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const layer of group.children) {
      const ln = (layer.name || '').toLowerCase().trim();
      const isHidden = layer.hidden === true;
      const isNonInk = NON_INK_NAMES.has(ln);
      // Blank layers (no canvas) can still carry stored bounds — often used
      // for Pantone callouts. Include them so the group size matches
      // Photoshop and the printer still sees the separation.
      const excludeFromBounds = isHidden || isNonInk;

      if (isTag) {
        // For tags, measure only the first non-excluded layer for dimensions
        if (!excludeFromBounds && minL === Infinity) {
          minL = layer.left; minT = layer.top; maxR = layer.right; maxB = layer.bottom;
        }
      } else if (!excludeFromBounds) {
        minL = Math.min(minL, layer.left);
        minT = Math.min(minT, layer.top);
        maxR = Math.max(maxR, layer.right);
        maxB = Math.max(maxB, layer.bottom);
      }
      // List as a separation unless it's hidden or a template helper
      if (!isHidden && !isNonInk) {
        colors.push({ name: layer.name, hex: sampleLayerColor(layer.canvas) });
      }
    }

    const artW = maxR - minL;
    const artH = maxB - minT;
    if (artW <= 0 || artH <= 0) continue;

    // Only composite onto mockup if there's a mapped placement zone
    if (zoneName) {
      const zone = ZONES[zoneName];
      const artCanvas = document.createElement('canvas');
      artCanvas.width = artW;
      artCanvas.height = artH;
      const artCtx = artCanvas.getContext('2d');
      for (const layer of group.children) {
        if (layer.canvas) {
          artCtx.drawImage(layer.canvas, layer.left - minL, layer.top - minT);
        }
      }

      const scaledW = Math.round(artW * DPI_SCALE);
      const scaledH = Math.round(artH * DPI_SCALE);
      const drawX = Math.round(zone.centerX - scaledW / 2);
      const drawY = zone.top;

      ctx.drawImage(artCanvas, 0, 0, artW, artH, drawX, drawY, scaledW, scaledH);
    }

    // Always extract print info for the proof PDF
    printInfo.push({
      placement: zoneName || group.name,
      groupName: group.name,
      widthInches: (artW / 300).toFixed(2),
      heightInches: (artH / 300).toFixed(2),
      colors,
    });
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
