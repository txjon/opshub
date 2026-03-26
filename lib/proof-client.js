import jsPDF from 'jspdf';

// HPD logo as a simple text fallback + styled header
function isLightColor(hex) {
  if (!hex || hex.length < 7) return false;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150;
}

export function generateProofPdfClient({ mockupDataUrl, printInfo, clientName, itemName, blankVendor, blankStyle, blankColor, decoratorName }) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'letter' });
  const pageW = 612;
  const margin = 50;
  const contentW = pageW - margin * 2;
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const blankStr = [blankVendor, blankStyle, blankColor].filter(Boolean).join(' — ') || '—';

  // ── Header bar ──
  doc.setFillColor(26, 31, 46);
  doc.rect(0, 0, pageW, 90, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('house party distro', margin, 38);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(138, 146, 176);
  doc.text('3945 W Reno Ave, Ste A · Las Vegas, NV 89118 · jon@housepartydistro.com', margin, 54);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.setTextColor(255, 255, 255);
  doc.text('Print Proof', pageW - margin, 38, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(138, 146, 176);
  doc.text(today, pageW - margin, 54, { align: 'right' });

  let y = 110;

  // ── Info row ──
  const infoCols = [
    { label: 'CLIENT', value: clientName || '—' },
    { label: 'ITEM', value: itemName || '—' },
    { label: 'BLANK', value: blankStr },
    { label: 'DECORATOR', value: decoratorName || '—' },
  ];
  const colW = contentW / infoCols.length;

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.rect(margin, y, contentW, 36);

  infoCols.forEach((col, i) => {
    const x = margin + i * colW + 8;
    if (i > 0) {
      doc.line(margin + i * colW, y, margin + i * colW, y + 36);
    }
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(170, 170, 170);
    doc.text(col.label, x, y + 14);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    doc.text(col.value, x, y + 26, { maxWidth: colW - 16 });
  });

  y += 52;

  // ── Mockup image ──
  if (mockupDataUrl) {
    doc.setFillColor(247, 247, 247);
    const imgW = contentW;
    const imgH = contentW / 2; // 2:1 aspect ratio
    doc.roundedRect(margin, y, imgW, imgH + 24, 3, 3, 'F');
    doc.addImage(mockupDataUrl, 'PNG', margin + 12, y + 12, imgW - 24, imgH);
    y += imgH + 36;
  }

  // ── Dark summary bar ──
  const totalLocations = (printInfo || []).length;
  const totalColors = (printInfo || []).reduce((a, p) => a + (p.colors?.length || 0), 0);

  doc.setFillColor(34, 34, 34);
  doc.rect(margin, y, contentW, 22, 'F');

  doc.setFontSize(8);
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'normal');

  let barX = margin + 10;
  doc.setTextColor(255, 255, 255, 0.6);
  doc.setFontSize(7);
  doc.text('LOCATIONS', barX, y + 14);
  barX += 52;
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text(String(totalLocations), barX, y + 14);
  barX += 30;

  doc.setTextColor(255, 255, 255, 0.6);
  doc.setFontSize(7);
  doc.text('TOTAL COLORS', barX, y + 14);
  barX += 68;
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8.5);
  doc.text(String(totalColors), barX, y + 14);

  y += 34;

  // ── Print placements ──
  for (const p of (printInfo || [])) {
    // Left border accent
    doc.setFillColor(26, 26, 26);
    doc.rect(margin, y, 3, 44, 'F');

    // Placement name
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor(26, 26, 26);
    doc.text(p.placement, margin + 16, y + 16);

    // Size
    doc.setFont('courier', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(136, 136, 136);
    doc.text(`${p.widthInches}" × ${p.heightInches}"`, pageW - margin, y + 16, { align: 'right' });

    // Color swatches
    let swatchX = margin + 16;
    const swatchY = y + 26;
    for (const c of (p.colors || [])) {
      const light = isLightColor(c.hex);
      const textW = doc.getTextWidth(c.name);
      const pillW = textW + 24;

      // Pill background
      const r = parseInt(c.hex.slice(1, 3), 16);
      const g = parseInt(c.hex.slice(3, 5), 16);
      const b = parseInt(c.hex.slice(5, 7), 16);
      doc.setFillColor(r, g, b);
      doc.roundedRect(swatchX, swatchY, pillW, 16, 8, 8, 'F');

      if (light) {
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.5);
        doc.roundedRect(swatchX, swatchY, pillW, 16, 8, 8, 'S');
      }

      // Circle swatch
      doc.circle(swatchX + 10, swatchY + 8, 4, 'F');

      // Color name
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(light ? 34 : 255, light ? 34 : 255, light ? 34 : 255);
      doc.text(c.name, swatchX + 18, swatchY + 11);

      swatchX += pillW + 6;
    }

    y += 52;
  }

  // ── Footer ──
  y += 8;
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.line(margin, y, margin + contentW, y);
  y += 12;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(136, 136, 136);
  doc.text('Print Proof — House Party Distro', margin, y);
  y += 10;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(170, 170, 170);
  doc.text(
    'This proof represents print placement, sizing, and ink colors for the specified item. Please review all details and confirm approval before production begins. Colors shown are approximate — refer to Pantone references for exact ink matching.',
    margin,
    y,
    { maxWidth: contentW }
  );

  return doc;
}
