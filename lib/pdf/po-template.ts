export interface POLineItem {
  style: string;
  description: string;
  color: string;
  sizes: Record<string, number>; // e.g. { S: 12, M: 24, L: 12 }
  total_qty: number;
  unit_cost: number;
  line_total: number;
  decoration?: string;
}

export interface POData {
  po_number: string;
  po_date: string;
  job_name: string;
  job_id: string;
  vendor_name: string;
  vendor_email?: string;
  vendor_address?: string;
  ship_to_name?: string;
  ship_to_address?: string;
  ship_to_city?: string;
  ship_to_state?: string;
  ship_to_zip?: string;
  ship_by_date?: string;
  decoration_type?: string;
  art_reference?: string;
  carrier_account?: string;
  line_items: POLineItem[];
  subtotal: number;
  shipping?: number;
  total: number;
  special_instructions?: string;
  logo_url?: string;
}

export function renderPOHTML(data: POData): string {
  const formatCurrency = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

  const formatDate = (d: string) =>
    new Date(d).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    });

  // Collect all unique sizes across line items
  const allSizes = Array.from(
    new Set(data.line_items.flatMap((item) => Object.keys(item.sizes)))
  );

  const sizeHeaders = allSizes.map((s) => `<th class="col-size">${s}</th>`).join("");

  const lineItemsHTML = data.line_items
    .map(
      (item, i) => `
      <tr class="${i % 2 === 0 ? "row-even" : "row-odd"}">
        <td class="col-style">${item.style}</td>
        <td class="col-desc">
          <strong>${item.description}</strong>
          ${item.color ? `<div class="sub">${item.color}</div>` : ""}
          ${item.decoration ? `<div class="sub">${item.decoration}</div>` : ""}
        </td>
        ${allSizes.map((s) => `<td class="col-size">${item.sizes[s] ?? "—"}</td>`).join("")}
        <td class="col-qty"><strong>${item.total_qty.toLocaleString()}</strong></td>
        <td class="col-cost">${formatCurrency(item.unit_cost)}</td>
        <td class="col-total">${formatCurrency(item.line_total)}</td>
      </tr>`
    )
    .join("");

  // Size totals row
  const sizeTotalsHTML = allSizes
    .map((s) => {
      const sum = data.line_items.reduce((acc, item) => acc + (item.sizes[s] ?? 0), 0);
      return `<td class="col-size totals-cell">${sum || "—"}</td>`;
    })
    .join("");

  const grandQty = data.line_items.reduce((acc, i) => acc + i.total_qty, 0);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>PO ${data.po_number}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 10.5px;
      color: #1a1a1a;
      background: white;
    }

    /* HEADER */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding: 28px 36px 20px;
      border-bottom: 3px solid #111;
    }
    .logo-area .company-name {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #111;
    }
    .logo-area img { max-height: 52px; max-width: 180px; object-fit: contain; }
    .po-meta { text-align: right; }
    .po-meta .doc-title {
      font-size: 18px;
      font-weight: 700;
      color: #c8001a;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      margin-bottom: 8px;
    }
    .po-meta table { margin-left: auto; }
    .po-meta td { padding: 1px 4px; }
    .po-meta td:first-child { color: #666; text-align: right; }
    .po-meta td:last-child { font-weight: 600; text-align: right; }

    /* INFO GRID */
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 0;
      border-bottom: 1px solid #ddd;
    }
    .info-cell {
      padding: 16px 24px;
      border-right: 1px solid #ddd;
    }
    .info-cell:last-child { border-right: none; }
    .info-label {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #999;
      font-weight: 700;
      margin-bottom: 6px;
    }
    .info-cell .primary { font-weight: 700; font-size: 12px; margin-bottom: 3px; }
    .info-cell p { color: #444; line-height: 1.5; font-size: 10px; }
    .info-cell .highlight { color: #c8001a; font-weight: 700; }

    /* TABLE */
    .items-section { padding: 20px 36px 0; }
    .section-title {
      font-size: 8px;
      text-transform: uppercase;
      letter-spacing: 1.5px;
      color: #999;
      font-weight: 700;
      margin-bottom: 8px;
    }
    table.line-items {
      width: 100%;
      border-collapse: collapse;
      font-size: 10px;
    }
    table.line-items thead tr { background: #c8001a; color: white; }
    table.line-items thead th {
      padding: 7px 8px;
      text-align: left;
      font-size: 8.5px;
      text-transform: uppercase;
      letter-spacing: 0.8px;
      font-weight: 600;
    }
    .col-size, .col-qty, .col-cost, .col-total { text-align: center; }
    .col-cost, .col-total { text-align: right; }
    table.line-items tbody td {
      padding: 8px 8px;
      vertical-align: top;
      border-bottom: 1px solid #eee;
    }
    .row-even { background: white; }
    .row-odd { background: #fafafa; }
    .col-style { white-space: nowrap; font-weight: 600; color: #333; }
    .col-total { font-weight: 700; }
    .sub { color: #888; font-size: 9px; margin-top: 2px; }
    
    /* TOTALS ROW */
    .totals-row td {
      background: #f0f0f0;
      padding: 8px 8px;
      font-weight: 700;
      border-top: 2px solid #ccc;
    }
    .totals-cell { text-align: center; color: #555; }

    /* SUMMARY */
    .summary-section {
      display: flex;
      justify-content: space-between;
      padding: 20px 36px;
      gap: 32px;
    }
    .instructions-col { flex: 1; }
    .instructions-col .section-title { margin-bottom: 8px; }
    .instructions-col p { color: #444; line-height: 1.6; font-size: 10px; }
    .amounts-col { min-width: 240px; }
    table.amounts { width: 100%; border-collapse: collapse; }
    table.amounts td { padding: 5px 8px; }
    .amt-label { color: #555; text-align: right; }
    .amt-value { text-align: right; font-weight: 600; white-space: nowrap; }
    .grand-total td {
      border-top: 2px solid #111;
      padding-top: 7px;
      font-size: 13px;
      font-weight: 800;
    }

    /* SIGNATURE LINE */
    .sig-section {
      padding: 16px 36px 0;
      border-top: 1px solid #eee;
      display: flex;
      gap: 48px;
    }
    .sig-block { flex: 1; }
    .sig-line {
      border-bottom: 1px solid #999;
      margin-bottom: 4px;
      height: 28px;
    }
    .sig-caption { font-size: 8.5px; color: #888; }

    /* BOTTOM */
    .bottom-bar {
      margin-top: 24px;
      background: #111;
      color: white;
      padding: 10px 36px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 9px;
    }
    .bottom-bar .tagline { color: #aaa; }
    .bottom-bar .po-ref { font-weight: 600; }
  </style>
</head>
<body>

  <div class="header">
    <div class="logo-area">
      ${
        data.logo_url
          ? `<img src="${data.logo_url}" alt="Logo" />`
          : `<div class="company-name">House Party Distro</div>`
      }
    </div>
    <div class="po-meta">
      <div class="doc-title">Purchase Order</div>
      <table>
        <tr><td>PO #</td><td>${data.po_number}</td></tr>
        <tr><td>Date</td><td>${formatDate(data.po_date)}</td></tr>
        <tr><td>Project</td><td>${data.job_name}</td></tr>
        ${data.ship_by_date ? `<tr><td>Ship By</td><td class="highlight">${formatDate(data.ship_by_date)}</td></tr>` : ""}
      </table>
    </div>
  </div>

  <div class="info-grid">
    <div class="info-cell">
      <div class="info-label">Vendor</div>
      <div class="primary">${data.vendor_name}</div>
      ${data.vendor_email ? `<p>${data.vendor_email}</p>` : ""}
      ${data.vendor_address ? `<p>${data.vendor_address}</p>` : ""}
    </div>
    <div class="info-cell">
      <div class="info-label">Ship To</div>
      ${
        data.ship_to_name
          ? `<div class="primary">${data.ship_to_name}</div>
            ${data.ship_to_address ? `<p>${data.ship_to_address}</p>` : ""}
            ${data.ship_to_city ? `<p>${data.ship_to_city}${data.ship_to_state ? ", " + data.ship_to_state : ""} ${data.ship_to_zip ?? ""}</p>` : ""}`
          : `<p>—</p>`
      }
    </div>
    <div class="info-cell">
      <div class="info-label">Decoration Details</div>
      ${data.decoration_type ? `<div class="primary">${data.decoration_type}</div>` : ""}
      ${data.art_reference ? `<p>Art Ref: ${data.art_reference}</p>` : ""}
      ${data.carrier_account ? `<p>Carrier Acct: <strong>${data.carrier_account}</strong></p>` : ""}
    </div>
  </div>

  <div class="items-section">
    <div class="section-title">Line Items</div>
    <table class="line-items">
      <thead>
        <tr>
          <th>Style</th>
          <th>Description</th>
          ${sizeHeaders}
          <th class="col-qty">Total Qty</th>
          <th class="col-cost">Unit Cost</th>
          <th class="col-total">Line Total</th>
        </tr>
      </thead>
      <tbody>
        ${lineItemsHTML}
        <tr class="totals-row">
          <td colspan="2" style="text-align:right; color:#555;">Totals</td>
          ${sizeTotalsHTML}
          <td class="col-qty totals-cell"><strong>${grandQty.toLocaleString()}</strong></td>
          <td></td>
          <td class="col-total" style="text-align:right;">${formatCurrency(data.subtotal)}</td>
        </tr>
      </tbody>
    </table>
  </div>

  <div class="summary-section">
    <div class="instructions-col">
      ${
        data.special_instructions
          ? `<div class="section-title">Special Instructions</div>
            <p>${data.special_instructions}</p>`
          : ""
      }
    </div>
    <div class="amounts-col">
      <table class="amounts">
        <tr>
          <td class="amt-label">Subtotal</td>
          <td class="amt-value">${formatCurrency(data.subtotal)}</td>
        </tr>
        ${
          data.shipping != null
            ? `<tr>
                <td class="amt-label">Shipping</td>
                <td class="amt-value">${formatCurrency(data.shipping)}</td>
              </tr>`
            : ""
        }
        <tr class="grand-total">
          <td class="amt-label">PO Total</td>
          <td class="amt-value">${formatCurrency(data.total)}</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="sig-section">
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-caption">Authorized Signature · House Party Distro</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-caption">Vendor Acknowledgment · ${data.vendor_name}</div>
    </div>
    <div class="sig-block">
      <div class="sig-line"></div>
      <div class="sig-caption">Date</div>
    </div>
  </div>

  <div class="bottom-bar">
    <span class="tagline">House Party Distro · Internal Use Only</span>
    <span class="po-ref">PO ${data.po_number} · ${data.job_name}</span>
  </div>

</body>
</html>`;
}
