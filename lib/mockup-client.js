import { readPsd } from 'ag-psd';

// Placement zones (template pixel coords at 40 DPI)
const ZONES = {
  'Full Front': { centerX: 680, centerY: 714, maxW: 568, maxH: 726 },
  'Left Chest': { centerX: 833, centerY: 475, maxW: 164, maxH: 165 },
  'Full Back':  { centerX: 2107, centerY: 671, maxW: 568, maxH: 726 },
};

const PLACEMENT_MAP = {
  'Front':      'Full Front',
  'Full Front': 'Full Front',
  'Back':       'Full Back',
  'Full Back':  'Full Back',
  'Left Chest': 'Left Chest',
};

const DPI_SCALE = 40 / 300;

// Cache the parsed template
let cachedTemplate = null;

async function loadTemplate() {
  if (cachedTemplate) return cachedTemplate;
  const res = await fetch('/templates/Tee Mockup Template.psd');
  const buffer = await res.arrayBuffer();
  cachedTemplate = readPsd(new Uint8Array(buffer));
  return cachedTemplate;
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

  // 2. Place print art
  const printInfo = [];
  for (const group of printPsd.children) {
    if (!group.children) continue;
    const zoneName = PLACEMENT_MAP[group.name];
    if (!zoneName) continue;

    const zone = ZONES[zoneName];
    const colors = [];

    let minL = Infinity, minT = Infinity, maxR = -Infinity, maxB = -Infinity;
    for (const layer of group.children) {
      minL = Math.min(minL, layer.left);
      minT = Math.min(minT, layer.top);
      maxR = Math.max(maxR, layer.right);
      maxB = Math.max(maxB, layer.bottom);
      colors.push({ name: layer.name, hex: sampleLayerColor(layer.canvas) });
    }

    const artW = maxR - minL;
    const artH = maxB - minT;

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
    const drawY = Math.round(zone.centerY - scaledH / 2);

    ctx.drawImage(artCanvas, 0, 0, artW, artH, drawX, drawY, scaledW, scaledH);

    printInfo.push({
      placement: zoneName,
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

  // Full size data URL for display + PDF embedding
  const dataUrl = canvas.toDataURL('image/png');
  const mockupBase64 = dataUrl.split(',')[1];

  // Smaller PNG for Drive upload (half size keeps it under upload limits)
  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.width = Math.round(canvas.width / 2);
  uploadCanvas.height = Math.round(canvas.height / 2);
  const uploadCtx = uploadCanvas.getContext('2d');
  uploadCtx.drawImage(canvas, 0, 0, uploadCanvas.width, uploadCanvas.height);
  const uploadBlob = await new Promise(resolve => uploadCanvas.toBlob(resolve, 'image/png'));

  return { mockupBase64, dataUrl, uploadBlob, printInfo };
}
