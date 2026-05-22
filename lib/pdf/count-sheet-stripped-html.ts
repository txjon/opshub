import { CountSheetData, CountSheetProduct } from "./count-sheet-types";

// Stripped count sheet — bare-bones SKU · Item · Qty list. No
// counted-qty boxes, no signoff strip, no instructions. Useful when
// the user just wants a printable inventory snapshot for reference,
// not a worksheet for a physical count.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderRows(p: CountSheetProduct): string {
  return p.variants
    .map((v) => {
      const item = [p.title, v.variantLabel].filter(Boolean).join(" — ");
      return `
      <tr>
        <td class="sku">${escapeHtml(v.sku || "—")}</td>
        <td class="item">${escapeHtml(item)}</td>
        <td class="qty">${v.systemQty}</td>
      </tr>`;
    })
    .join("");
}

export function renderCountSheetStrippedHTML(data: CountSheetData): string {
  const rowsHtml = data.products.map(renderRows).join("\n");
  const reportRef = escapeHtml(data.reportRef);
  const logoBlock = data.companyLogoSvg
    ? data.companyLogoSvg
    : `<div class="company-name">${escapeHtml((data.companyName || "").toUpperCase())}</div>`;

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
      font-size: 9px; color: #888;
    }
    @bottom-left {
      content: "${reportRef}";
      font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
      font-size: 9px; color: #888; letter-spacing: 0.5px;
    }
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
    color: #111; font-size: 11px; line-height: 1.4;
  }
  .header {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding-bottom: 12px; border-bottom: 4px solid #111; margin-bottom: 16px;
  }
  .logo-area .company-name { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #111; }
  .logo-area .tagline {
    font-size: 9px; color: #999; letter-spacing: 1.5px;
    text-transform: uppercase; margin-top: 4px;
  }
  .meta { text-align: right; }
  .meta .doc-title { font-size: 18px; font-weight: 700; color: #111; margin-bottom: 6px; }
  .meta table { font-size: 10px; }
  .meta table td { padding: 1px 0; }
  .meta table td:first-child {
    color: #999; text-transform: uppercase; letter-spacing: 1px;
    font-size: 8px; padding-right: 12px;
  }
  .meta table td:last-child { text-align: right; font-weight: 600; }
  table.list { width: 100%; border-collapse: collapse; font-size: 11px; }
  table.list thead tr { background: #f0f0f0; border-bottom: 1px solid #ccc; }
  table.list thead th {
    padding: 7px 10px; text-align: left;
    font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.8px;
    font-weight: 700; color: #666;
  }
  table.list thead th.qty { text-align: right; }
  table.list tbody td {
    padding: 8px 10px; border-bottom: 1px solid #eee; vertical-align: middle;
  }
  table.list tbody tr:nth-child(even) { background: #fafafa; }
  td.sku { font-family: "Courier New", monospace; font-size: 11px; color: #444; width: 22%; }
  td.item { font-weight: 500; font-size: 11.5px; color: #111; }
  td.qty {
    text-align: right; font-weight: 700; font-size: 13px; color: #111;
    width: 12%; font-variant-numeric: tabular-nums;
  }
  .footer {
    margin-top: 24px; padding-top: 12px; border-top: 2px solid #111;
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
      <div class="tagline">Inventory Snapshot</div>
    </div>
    <div class="meta">
      <div class="doc-title">Inventory</div>
      <table>
        <tr><td>Date</td><td>${escapeHtml(data.reportDate)}</td></tr>
        <tr><td>Reference</td><td>${reportRef}</td></tr>
        <tr><td>Products</td><td>${data.totalProducts}</td></tr>
        <tr><td>Variants</td><td>${data.totalVariants}</td></tr>
      </table>
    </div>
  </div>

  <table class="list">
    <thead>
      <tr>
        <th class="sku">SKU</th>
        <th class="item">Item</th>
        <th class="qty">Qty</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}
    </tbody>
  </table>

  <div class="footer">
    <div class="tagline">Welcome to the Party</div>
    <div>${reportRef}</div>
  </div>
</body>
</html>`;
}
