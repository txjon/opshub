import { DropValuationData, ValuationProductRow } from "./drop-valuation-types";

const currencyFmt = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const intFmt = new Intl.NumberFormat("en-US");

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderProductRow(p: ValuationProductRow, i: number): string {
  const rowClass = i % 2 === 0 ? "row-even" : "row-odd";
  return `
        <tr class="${rowClass}">
          <td class="col-style">${escapeHtml(p.title)}</td>
          <td class="col-variants">${intFmt.format(p.variantCount)}</td>
          <td class="col-qty">${intFmt.format(p.units)}</td>
          <td class="col-pct">${p.pctOfDrop.toFixed(1)}%</td>
          <td class="col-total">${currencyFmt.format(p.retailValue)}</td>
        </tr>`;
}

export function renderDropValuationHTML(data: DropValuationData): string {
  const productRows = data.products.map(renderProductRow).join("");
  const companyName = (data.companyName || "").toUpperCase();
  const reportRef = escapeHtml(data.reportRef);

  const logoBlock = data.companyLogoSvg
    ? data.companyLogoSvg
    : `<div class="company-name">${escapeHtml(companyName)}</div>`;

  const flagsHtml = data.flags.length
    ? data.flags
        .map(
          (f) =>
            `    <div class="note-flag"><strong>Flag:</strong> ${escapeHtml(f)}</div>`
        )
        .join("\n")
    : "";

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  @page { size: letter; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif; color: #111; font-size: 11px; line-height: 1.4; }
  .page { width: 100%; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; padding: 32px 40px 20px; border-bottom: 4px solid #111; }
  .logo-area .company-name { font-size: 22px; font-weight: 800; letter-spacing: 2px; color: #111; }
  .logo-area .tagline { font-size: 9px; color: #999; letter-spacing: 1.5px; text-transform: uppercase; margin-top: 4px; }
  .meta { text-align: right; }
  .meta .doc-title { font-size: 18px; font-weight: 700; color: #111; margin-bottom: 8px; }
  .meta table { font-size: 10px; }
  .meta table td { padding: 1px 0; }
  .meta table td:first-child { color: #999; text-transform: uppercase; letter-spacing: 1px; font-size: 8px; padding-right: 12px; }
  .meta table td:last-child { text-align: right; font-weight: 600; }
  .info-strip { display: flex; border-bottom: 1px solid #eee; }
  .info-cell { flex: 1; padding: 14px 18px; border-right: 1px solid #eee; }
  .info-cell:last-child { border-right: none; }
  .info-label { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 700; margin-bottom: 6px; }
  .info-cell .primary { font-weight: 700; font-size: 14px; color: #111; margin-bottom: 2px; }
  .info-cell .sub { color: #888; font-size: 9px; }
  .section { padding: 20px 40px 0; }
  .section-title { font-size: 8px; text-transform: uppercase; letter-spacing: 1.5px; color: #999; font-weight: 700; margin-bottom: 10px; }
  table.line-items { width: 100%; border-collapse: collapse; font-size: 10px; }
  table.line-items thead tr { background: #111; color: white; }
  table.line-items thead th { padding: 8px 10px; text-align: left; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.8px; font-weight: 600; }
  .col-variants, .col-qty, .col-pct, .col-total { text-align: right; }
  table.line-items tbody td { padding: 8px 10px; vertical-align: top; border-bottom: 1px solid #eee; }
  .row-even { background: white; }
  .row-odd { background: #fafafa; }
  .col-style { font-weight: 600; color: #333; }
  .col-total { font-weight: 700; }
  .totals-section { display: flex; justify-content: flex-end; padding: 16px 40px 0; }
  table.totals { min-width: 280px; border-collapse: collapse; }
  table.totals td { padding: 5px 10px; }
  .summary-label { color: #555; text-align: right; }
  .summary-value { text-align: right; font-weight: 600; white-space: nowrap; }
  .total-row td { border-top: 2px solid #111; padding-top: 10px; padding-bottom: 4px; }
  .total-row .summary-label { font-size: 13px; font-weight: 700; color: #111; }
  .total-row .summary-value { font-size: 15px; font-weight: 800; color: #111; }
  .footer-section { padding: 28px 40px 16px; }
  .footer-section p { color: #444; line-height: 1.6; font-size: 10px; }
  .footer-section .note-flag { background: #f5f5f5; border-left: 3px solid #111; padding: 10px 14px; margin-top: 10px; font-size: 10px; color: #333; }
  .bottom-bar { margin-top: 24px; background: #111; color: white; padding: 14px 40px; display: flex; justify-content: space-between; align-items: center; font-size: 9.5px; }
  .bottom-bar .tagline { color: #aaa; letter-spacing: 1px; text-transform: uppercase; }
  .bottom-bar .ref { font-weight: 600; letter-spacing: 0.5px; }
</style></head><body>
<div class="page">
  <div class="header">
    <div class="logo-area">
      ${logoBlock}
      <div class="tagline">Internal Report</div>
    </div>
    <div class="meta">
      <div class="doc-title">Drop Valuation</div>
      <table>
        <tr><td>Report Date</td><td>${escapeHtml(data.reportDate)}</td></tr>
        <tr><td>Reference</td><td>${reportRef}</td></tr>
        <tr><td>Source</td><td>Shopify Product Export</td></tr>
      </table>
    </div>
  </div>

  <div class="info-strip">
    <div class="info-cell">
      <div class="info-label">Total Retail Value</div>
      <div class="primary">${currencyFmt.format(data.totalValue)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Total Units</div>
      <div class="primary">${intFmt.format(data.totalUnits)}</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Products</div>
      <div class="primary">${intFmt.format(data.totalProducts)}</div>
      <div class="sub">${intFmt.format(data.totalVariants)} variants</div>
    </div>
    <div class="info-cell">
      <div class="info-label">Avg Retail / Unit</div>
      <div class="primary">${currencyFmt.format(data.avgRetailPerUnit)}</div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Line Items — Retail Value by Product</div>
    <table class="line-items">
      <thead>
        <tr>
          <th>Product</th>
          <th class="col-variants">Variants</th>
          <th class="col-qty">Units</th>
          <th class="col-pct">% of Drop</th>
          <th class="col-total">Retail Value</th>
        </tr>
      </thead>
      <tbody>${productRows}
      </tbody>
    </table>
  </div>

  <div class="totals-section">
    <table class="totals">
      <tr>
        <td class="summary-label">Subtotal — All Products</td>
        <td class="summary-value">${currencyFmt.format(data.totalValue)}</td>
      </tr>
      <tr class="total-row">
        <td class="summary-label">DROP TOTAL</td>
        <td class="summary-value">${currencyFmt.format(data.totalValue)}</td>
      </tr>
    </table>
  </div>

  <div class="footer-section">
    <div class="section-title">Notes</div>
    <p>Valuation calculated from current Shopify product export. Retail value = Variant Price × Variant Inventory Qty across all variants. Products with zero or untracked inventory are excluded from unit totals but listed for completeness.</p>
${flagsHtml}
  </div>

  <div class="bottom-bar">
    <div class="tagline">Welcome to the Party</div>
    <div class="ref">${reportRef}</div>
  </div>
</div>
</body></html>`;
}
