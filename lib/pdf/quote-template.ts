export interface QuoteLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  total: number;
  decoration?: string;
  color?: string;
  sizes?: string;
}

export interface QuoteData {
  quote_number: string;
  quote_date: string;
  valid_until?: string;
  job_name: string;
  job_id: string;
  client_name: string;
  client_email?: string;
  client_company?: string;
  line_items: QuoteLineItem[];
  subtotal: number;
  tax_rate?: number;
  tax_amount?: number;
  total: number;
  notes?: string;
  payment_terms?: string;
  deposit_percent?: number;
  deposit_amount?: number;
  logo_url?: string;
}

export function renderQuoteHTML(data: QuoteData): string {
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  const lineItemsHTML = data.line_items
    .map(
      (item, i) => `
      <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
        <td class="col-desc">
          <strong>${item.description}</strong>
          ${item.decoration ? `<div class="sub">${item.decoration}</div>` : ""}
          ${item.color ? `<div class="sub">Color: ${item.color}</div>` : ""}
          ${item.sizes ? `<div class="sub">Sizes: ${item.sizes}</div>` : ""}
        </td>
        <td class="col-qty">${item.quantity.toLocaleString()}</td>
        <td class="col-price">${formatCurrency(item.unit_price)}</td>
        <td class="col-total">${formatCurrency(item.total)}</td>
      </tr>`
    )
    .join("");

  const depositRow =
    data.deposit_amount != null
      ? `<tr>
          <td colspan="3" class="summary-label">Deposit Required (${data.deposit_percent ?? 50}%)</td>
          <td class="summary-value">${formatCurrency(data.deposit_amount)}</td>
        </tr>`
      : "";

  const taxRow =
    data.tax_amount != null
      ? `<tr>
          <td colspan="3" class="summary-label">Tax (${((data.tax_rate ?? 0) * 100).toFixed(2)}%)</td>
          <td class="summary-value">${formatCurrency(data.tax_amount)}</td>
        </tr>`
      : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Quote ${data.quote_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 11px;
      color: #1a1a1a;
      background: white;
    }
    .page { padding: 0; }

    /* HEADER */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 32px 40px 24px;
      border-bottom: 3px solid #111;
    }
    .logo-area img { max-height: 56px; max-width: 200px; object-fit: contain; }
    .logo-area .company-name {
      font-size: 22px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #111;
    }
    .quote-meta { text-align: right; }
    .quote-meta .doc-title {
      font-size: 20px;
      font-weight: 700;
      color: #111;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 8px;
    }
    .quote-meta table { margin-left: auto; }
    .quote-meta td { padding: 1px 4px; }
    .quote-meta td:first-child { color: #666; text-align: right; }
    .quote-meta td:last-child { font-weight: 600; text-align: right; }

    /* ADDRESSES */
    .addresses {
      display: flex;
      justify-content: space-between;
      padding: 24px 40px;
      background: #f8f8f8;
      border-bottom: 1px solid #e0e0e0;
    }
    .address-block { flex: 1; }
    .address-block + .address-block { margin-left: 40px; }
    .address-label {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #888;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .address-block .name { font-weight: 700; font-size: 13px; margin-bottom: 3px; }
    .address-block p { color: #444; line-height: 1.5; }

    /* LINE ITEMS */
    .items-section { padding: 24px 40px 0; }
    .section-title {
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #888;
      font-weight: 700;
      margin-bottom: 10px;
    }
    table.line-items {
      width: 100%;
      border-collapse: collapse;
    }
    table.line-items thead tr {
      background: #111;
      color: white;
    }
    table.line-items thead th {
      padding: 8px 10px;
      text-align: left;
      font-size: 9px;
      text-transform: uppercase;
      letter-spacing: 1px;
      font-weight: 600;
    }
    table.line-items thead th.col-qty,
    table.line-items thead th.col-price,
    table.line-items thead th.col-total { text-align: right; }
    table.line-items tbody td {
      padding: 9px 10px;
      vertical-align: top;
      border-bottom: 1px solid #eee;
    }
    .row-even { background: white; }
    .row-odd { background: #fafafa; }
    .col-qty, .col-price, .col-total { text-align: right; white-space: nowrap; }
    .col-desc { width: 55%; }
    .col-total { font-weight: 600; }
    .sub { color: #777; font-size: 9.5px; margin-top: 2px; }

    /* TOTALS */
    .totals-section {
      display: flex;
      justify-content: flex-end;
      padding: 16px 40px 0;
    }
    table.totals {
      min-width: 280px;
      border-collapse: collapse;
    }
    table.totals td { padding: 5px 10px; }
    .summary-label { color: #555; text-align: right; }
    .summary-value { text-align: right; font-weight: 600; white-space: nowrap; }
    .total-row td {
      border-top: 2px solid #111;
      padding-top: 8px;
      padding-bottom: 4px;
    }
    .total-row .summary-label {
      font-size: 13px;
      font-weight: 700;
      color: #111;
    }
    .total-row .summary-value {
      font-size: 15px;
      font-weight: 800;
      color: #111;
    }
    .deposit-row td { background: #f0f7ff; border-radius: 3px; }
    .deposit-row .summary-label { color: #1a56db; font-weight: 600; }
    .deposit-row .summary-value { color: #1a56db; }

    /* NOTES / TERMS */
    .footer-section { padding: 24px 40px; }
    .footer-grid { display: flex; gap: 40px; }
    .footer-col { flex: 1; }
    .footer-col .section-title { margin-bottom: 8px; }
    .footer-col p { color: #444; line-height: 1.6; font-size: 10.5px; }

    /* BOTTOM BAR */
    .bottom-bar {
      margin-top: 32px;
      background: #111;
      color: white;
      padding: 12px 40px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9.5px;
    }
    .bottom-bar .tagline { color: #aaa; }
    .bottom-bar .quote-ref { font-weight: 600; }
  </style>
</head>
<body>
<div class="page">

  <div class="header">
    <div class="logo-area">
      ${
        data.logo_url
          ? `<img src="${data.logo_url}" alt="Logo" />`
          : `<div class="company-name">House Party Distro</div>`
      }
    </div>
    <div class="quote-meta">
      <div class="doc-title">Client Quote</div>
      <table>
        <tr><td>Quote #</td><td>${data.quote_number}</td></tr>
        <tr><td>Date</td><td>${formatDate(data.quote_date)}</td></tr>
        ${data.valid_until ? `<tr><td>Valid Until</td><td>${formatDate(data.valid_until)}</td></tr>` : ""}
        <tr><td>Project</td><td>${data.job_name}</td></tr>
      </table>
    </div>
  </div>

  <div class="addresses">
    <div class="address-block">
      <div class="address-label">Prepared For</div>
      <div class="name">${data.client_name}</div>
      ${data.client_company ? `<p>${data.client_company}</p>` : ""}
      ${data.client_email ? `<p>${data.client_email}</p>` : ""}
    </div>
    <div class="address-block">
      <div class="address-label">Prepared By</div>
      <div class="name">House Party Distro</div>
      <p>hpdistro.com</p>
    </div>
  </div>

  <div class="items-section">
    <div class="section-title">Line Items</div>
    <table class="line-items">
      <thead>
        <tr>
          <th class="col-desc">Description</th>
          <th class="col-qty">Qty</th>
          <th class="col-price">Unit Price</th>
          <th class="col-total">Total</th>
        </tr>
      </thead>
      <tbody>${lineItemsHTML}</tbody>
    </table>
  </div>

  <div class="totals-section">
    <table class="totals">
      <tr>
        <td class="summary-label">Subtotal</td>
        <td class="summary-value">${formatCurrency(data.subtotal)}</td>
      </tr>
      ${taxRow}
      <tr class="total-row">
        <td class="summary-label">Total</td>
        <td class="summary-value">${formatCurrency(data.total)}</td>
      </tr>
      ${depositRow ? `<tr class="deposit-row">${depositRow.replace("<tr>", "").replace("</tr>", "")}</tr>` : ""}
    </table>
  </div>

  <div class="footer-section">
    <div class="footer-grid">
      ${
        data.payment_terms
          ? `<div class="footer-col">
              <div class="section-title">Payment Terms</div>
              <p>${data.payment_terms}</p>
            </div>`
          : ""
      }
      ${
        data.notes
          ? `<div class="footer-col">
              <div class="section-title">Notes</div>
              <p>${data.notes}</p>
            </div>`
          : ""
      }
    </div>
  </div>

  <div class="bottom-bar">
    <span class="tagline">Thank you for your business.</span>
    <span class="quote-ref">Quote ${data.quote_number} · House Party Distro</span>
  </div>

</div>
</body>
</html>`;
}
