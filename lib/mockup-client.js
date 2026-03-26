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

// Cache the loaded template image
let cachedTemplateImg = null;

async function loadTemplate() {
  if (cachedTemplateImg) return cachedTemplateImg;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { cachedTemplateImg = img; resolve(img); };
    img.onerror = () => reject(new Error('Failed to load template'));
    img.src = '/templates/tee-template.png';
  });
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
  const templateImg = await loadTemplate();

  const canvas = document.createElement('canvas');
  canvas.width = templateImg.width;
  canvas.height = templateImg.height;
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

  // 3. Clip to garment shape using template's own alpha
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(templateImg, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // 4. Draw template on top (multiply) for shadow/highlight detail
  ctx.globalCompositeOperation = 'multiply';
  ctx.drawImage(templateImg, 0, 0);
  ctx.globalCompositeOperation = 'source-over';

  // Full size data URL for display + PDF
  const dataUrl = canvas.toDataURL('image/png');
  const mockupBase64 = dataUrl.split(',')[1];

  // Smaller JPEG with white background for Drive upload
  const uploadCanvas = document.createElement('canvas');
  uploadCanvas.width = Math.round(canvas.width / 2);
  uploadCanvas.height = Math.round(canvas.height / 2);
  const uploadCtx = uploadCanvas.getContext('2d');
  uploadCtx.fillStyle = '#ffffff';
  uploadCtx.fillRect(0, 0, uploadCanvas.width, uploadCanvas.height);
  uploadCtx.drawImage(canvas, 0, 0, uploadCanvas.width, uploadCanvas.height);
  const uploadDataUrl = uploadCanvas.toDataURL('image/jpeg', 0.85);
  const uploadBase64 = uploadDataUrl.split(',')[1];

  return { mockupBase64, dataUrl, uploadBase64, uploadDataUrl, printInfo };
}
