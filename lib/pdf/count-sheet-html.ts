import { CountSheetData, CountSheetProduct } from "./count-sheet-types";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProductBlock(p: CountSheetProduct): string {
  const rows = p.variants
    .map(
      (v) => `
      <tr>
        <td class="sku">${escapeHtml(v.sku || "—")}</td>
        <td class="variant">${escapeHtml(v.variantLabel)}</td>
        <td class="sys-qty">${v.systemQty}</td>
        <td class="count-box"></td>
        <td class="match-box"><div class="check-circle"></div></td>
        <td class="notes-box"></td>
      </tr>`
    )
    .join("");

  return `
  <div class="product-block">
    <div class="product-header">${escapeHtml(p.title)}</div>
    <table class="count-table">
      <thead>
        <tr>
          <th class="sku">SKU</th>
          <th class="variant">Variant</th>
          <th class="sys-qty">System Qty</th>
          <th class="count-box">Counted Qty</th>
          <th class="match-box">Match?</th>
          <th class="notes-box">Notes</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>
  </div>`;
}

export function renderCountSheetHTML(data: CountSheetData): string {
  const productBlocks = data.products.map(renderProductBlock).join("\n");
  const companyName = (data.companyName || "").toUpperCase();
  const reportRef = escapeHtml(data.reportRef);
  const logoBlock = data.companyLogoSvg
    ? data.companyLogoSvg
    : `<div class="company-name">${escapeHtml(companyName)}</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page {
    size: letter;
    margin: 0.5in 0.4in;
    @bottom-right {
      content: "Page " counter(page) " of " counter(pages);
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 9px;
      color: #888;
    }
    @bottom-left {
      content: "${reportRef}";
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 9px;
      color: #888;
      letter-spacing: 0.5px;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111;
    font-size: 11px;
    line-height: 1.4;
  }
  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 16px;
    border-bottom: 4px solid #111;
    margin-bottom: 14px;
  }
  .logo-area .company-name {
    font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #111;
  }
  .logo-area .tagline {
    font-size: 9px; color: #999; letter-spacing: 1.5px;
    text-transform: uppercase; margin-top: 4px;
  }
  .meta { text-align: right; }
  .meta .doc-title { font-size: 18px; font-weight: 700; color: #111; margin-bottom: 8px; }
  .meta table { font-size: 10px; }
  .meta table td { padding: 1px 0; }
  .meta table td:first-child {
    color: #999; text-transform: uppercase; letter-spacing: 1px;
    font-size: 8px; padding-right: 12px;
  }
  .meta table td:last-child { text-align: right; font-weight: 600; }
  .signoff-strip { display: flex; border: 1px solid #ddd; margin-bottom: 18px; }
  .signoff-cell {
    flex: 1; padding: 12px 14px; border-right: 1px solid #ddd; min-height: 56px;
  }
  .signoff-cell:last-child { border-right: none; }
  .signoff-label {
    font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px;
    color: #999; font-weight: 700; margin-bottom: 8px;
  }
  .signoff-line { border-bottom: 1px solid #333; height: 22px; }
  .instructions {
    background: #f5f5f5; border-left: 3px solid #111;
    padding: 12px 16px; margin-bottom: 18px;
    font-size: 10.5px; line-height: 1.6;
  }
  .instructions strong { color: #111; }
  .product-block { margin-bottom: 22px; page-break-inside: avoid; }
  .product-header {
    background: #111; color: white; padding: 10px 14px;
    font-weight: 700; font-size: 13px; letter-spacing: 0.3px;
  }
  table.count-table { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.count-table thead tr { background: #f0f0f0; border-bottom: 1px solid #ccc; }
  table.count-table thead th {
    padding: 7px 10px; text-align: left;
    font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.8px;
    font-weight: 700; color: #666;
  }
  table.count-table thead th.sys-qty,
  table.count-table thead th.count-box,
  table.count-table thead th.match-box { text-align: center; }
  table.count-table tbody td {
    padding: 14px 10px; border-bottom: 1px solid #ddd; vertical-align: middle;
  }
  td.sku { font-family: "Courier New", monospace; font-size: 11px; color: #555; width: 18%; }
  td.variant { font-weight: 600; font-size: 12px; width: 18%; }
  td.sys-qty {
    text-align: center; font-weight: 700; font-size: 16px; color: #111; width: 12%;
  }
  td.count-box {
    width: 18%; border-left: 1px solid #ddd; border-right: 1px solid #ddd;
    background: #fafafa; height: 44px;
  }
  td.match-box { width: 10%; text-align: center; }
  .check-circle {
    width: 22px; height: 22px; border: 2px solid #111;
    border-radius: 50%; margin: 0 auto;
  }
  td.notes-box { width: 24%; background: #fafafa; border-left: 1px solid #ddd; }
  .footer {
    margin-top: 24px; padding-top: 14px; border-top: 2px solid #111;
    display: flex; justify-content: space-between;
    font-size: 9.5px; color: #666;
  }
  .footer .tagline { letter-spacing: 1px; text-transform: uppercase; }
</style>
</head>
<body>
  <div class="header">
    <div class="logo-area">
      ${logoBlock}
      <div class="tagline">Inventory Count Sheet</div>
    </div>
    <div class="meta">
      <div class="doc-title">Physical Count</div>
      <table>
        <tr><td>Sheet Date</td><td>${escapeHtml(data.reportDate)}</td></tr>
        <tr><td>Reference</td><td>${reportRef}</td></tr>
        <tr><td>Products</td><td>${data.totalProducts}</td></tr>
        <tr><td>Variants</td><td>${data.totalVariants}</td></tr>
      </table>
    </div>
  </div>

  <div class="signoff-strip">
    <div class="signoff-cell"><div class="signoff-label">Counted By</div><div class="signoff-line"></div></div>
    <div class="signoff-cell"><div class="signoff-label">Date Started</div><div class="signoff-line"></div></div>
    <div class="signoff-cell"><div class="signoff-label">Date Completed</div><div class="signoff-line"></div></div>
    <div class="signoff-cell"><div class="signoff-label">Verified By</div><div class="signoff-line"></div></div>
  </div>

  <div class="instructions">
    <strong>Instructions:</strong> Count each variant physically. Write the actual count in the "Counted Qty" box. If the counted qty matches System Qty, fill in the circle under "Match?". If counts do not match, leave the circle blank and write a brief note (location, damage, mislabeled, etc.) in the Notes column.
  </div>

  ${productBlocks}

  <div class="footer">
    <div class="tagline">Welcome to the Party</div>
    <div>${reportRef}</div>
  </div>
</body>
</html>`;
}
