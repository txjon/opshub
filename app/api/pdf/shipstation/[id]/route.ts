export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { groupLineItems } from "@/lib/shipstation-group";
import { getPdfBranding } from "@/lib/branding";

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");
// Strip any time component off ship_date. ShipStation often exports
// "M/D/YYYY H:MM AM/PM" or ISO "YYYY-MM-DDTHH:MM:SS" and the date-only
// portion is what the report should show.
function dateOnly(raw: string): string {
  if (!raw) return "";
  return raw.trim().split(/[\sT]/)[0];
}

// HPD logo — same SVG used on the invoice PDF for consistency.

type LineItem = { sku: string; description: string; qty_sold: number; product_sales: number; unit_cost: number };
type PostageLine = {
  ship_date: string; recipient: string; order_number: string;
  provider: string; service: string; package_type: string;
  items_count: number; zone: string;
  shipping_paid: number; shipping_cost_raw: number; shipping_cost: number;
  insurance_cost: number; weight: number; weight_unit: string; billed: number;
};
type PostageTotals = { shipments: number; items: number; paid: number; cost_raw: number; cost: number; insurance: number; billed: number; margin: number; fulfillment?: number; invoice_total?: number };

function renderSalesReportHTML(data: {
  clientName: string;
  clientBillingAddress: string | null;
  clientBillingEmail: string | null;
  invoiceNumber: string | null;
  periodLabel: string;
  generatedOn: string;
  feePct: number;
  lines: LineItem[];
  totals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number };
  branding: import("@/lib/branding").PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  // Stacked per-item blocks. Each block owns the full page width so
  // long descriptions and size breakdowns never wrap inside a narrow
  // column. Three tiers per item:
  //   1. Identity row   — SKU · item name · Qty
  //   2. Sizes row      — inline, muted, only when multiple variants
  //   3. Money chip row — 6-column mini KPI strip matching the
  //                       document-level chips at the top of the report
  // Document-level KPI strip — rendered identically at the top of the
  // report (running header) and at the bottom (running footer). Having
  // it in both places means a multi-page report always has totals
  // visible on the page the reader lands on.
  const totalsStrip = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);border-top:0.5px solid #e5e7eb;border-bottom:0.5px solid #e5e7eb;font-family:${font}">
      ${[
        ["Qty Sold", fmtN(data.totals.qty)],
        ["Product Sales", fmtD(data.totals.sales)],
        ["Total Cost", fmtD(data.totals.cost)],
        ["Product Net", fmtD(data.totals.net)],
        [`HPD Fee (${(data.feePct * 100).toFixed(1)}%)`, fmtD(data.totals.fee)],
        ["Net Profit", fmtD(data.totals.profit)],
      ].map(([k, v], i, arr) =>
        `<div style="padding:12px 14px;${i < arr.length - 1 ? "border-right:0.5px solid #e5e7eb" : ""}">
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">${k}</div>
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;font-family:monospace">${v}</div>
        </div>`
      ).join("")}
    </div>`;

  const groups = groupLineItems(data.lines);
  // Borderless numeric cell — all 6 per-item values render on an
  // aligned 6-column grid so the client can scan any column vertically
  // across items (Sales by item, Profit by item, etc.) without the
  // chrome of chip borders. Label + value both center-aligned inside
  // their column so the title sits visually over the dollar figure,
  // matching the top KPI strip's tile rhythm. Profit gets heavier
  // weight as the takeaway.
  const numCell = (label: string, value: string, opts: { bold?: boolean } = {}) => `
    <div style="padding:0;white-space:nowrap;text-align:center">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">${escapeHtml(label)}</div>
      <div style="font-size:${opts.bold ? 12 : 11}px;font-weight:${opts.bold ? 800 : 600};color:#1a1a1a;font-family:monospace">${escapeHtml(value)}</div>
    </div>`;
  const rows = groups.map(g => {
    const totalCost = g.unit_cost * g.qty_sold;
    const net = g.product_sales - totalCost;
    const fee = net * data.feePct;
    const profit = net - fee;
    const hasSizes = g.variants.length > 1 && g.variants.some(v => v.qty_sold > 0);
    const sizesLine = hasSizes
      ? g.variants
          .filter(v => v.qty_sold > 0)
          .map(v => `<span style="white-space:nowrap"><span style="color:#aaa;font-weight:600;margin-right:3px">${escapeHtml(v.size || v.sku)}</span>${fmtN(v.qty_sold)}</span>`)
          .join(`<span style="color:#ccc;margin:0 9px">·</span>`)
      : "";
    return `
    <div style="padding:10px 0 14px;border-bottom:0.5px solid #eeeeee;font-family:${font};page-break-inside:avoid;break-inside:avoid">

      <!-- Identity row: name · sku · Qty. Uses the same 6-column grid
           as the KPI row below so Qty centers directly above Profit. -->
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0 10px;align-items:baseline">
        <div style="grid-column:1 / 6;min-width:0;white-space:nowrap;overflow:visible">
          <span style="font-size:13px;font-weight:700;color:#1a1a1a;letter-spacing:-0.005em">${escapeHtml(g.root_description || "—")}</span>
          <span style="font-family:monospace;font-size:9px;color:#aaa;font-weight:500;margin-left:8px">${escapeHtml(g.root_sku || "—")}</span>
        </div>
        <div style="grid-column:6;text-align:center;white-space:nowrap">
          <span style="color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;font-size:9px;margin-right:6px">Qty</span>
          <span style="color:#1a1a1a;font-weight:700;font-family:monospace;font-size:13px">${fmtN(g.qty_sold)}</span>
        </div>
      </div>

      ${hasSizes ? `
      <!-- Sizes row -->
      <div style="margin-top:4px;font-family:monospace;font-size:10px;color:#666;line-height:1.5;white-space:nowrap;overflow:visible">
        ${sizesLine}
      </div>` : ""}

      <!-- Borderless numeric grid — aligns vertically across items -->
      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(6,1fr);gap:0 10px">
        ${numCell("Sales", fmtD(g.product_sales))}
        ${numCell("Unit Cost", fmtD(g.unit_cost))}
        ${numCell("Total Cost", fmtD(totalCost))}
        ${numCell("Net", fmtD(net))}
        ${numCell("HPD Fee", fmtD(fee))}
        ${numCell("Profit", fmtD(profit), { bold: true })}
      </div>

    </div>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:1040px;margin:0 auto">

  <!-- ============ COVER PAGE — Services Invoice ============ -->
  <!-- Mirrors the Fulfillment Invoice cover so clients immediately
       recognize this as a bill, not a passive report. The actual
       per-item breakdown begins on page 2 (forced page break below). -->

  <!-- Header -->
  <div style="padding:36px 40px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${data.branding.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          ${data.branding.headerAddressHtml}${data.branding.fromEmailQuotes ? "<br/>" + data.branding.fromEmailQuotes : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">
          SERVICES INVOICE
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          ${data.invoiceNumber ? `<div><span style="font-weight:600">Invoice #:</span> ${escapeHtml(data.invoiceNumber)}</div>` : ""}
          <div><span style="font-weight:600">Date:</span> ${escapeHtml(data.generatedOn)}</div>
          <div><span style="font-weight:600">Period:</span> ${escapeHtml(data.periodLabel)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bill to -->
  <div style="padding:24px 40px 8px;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:6px">Bill To</div>
    <div style="font-size:15px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)}</div>
    ${data.clientBillingAddress ? `<div style="font-size:11px;color:#444;line-height:1.6;margin-top:4px;white-space:pre-line">${escapeHtml(data.clientBillingAddress)}</div>` : ""}
    ${data.clientBillingEmail ? `<div style="font-size:11px;color:#444;margin-top:4px">${escapeHtml(data.clientBillingEmail)}</div>` : ""}
  </div>

  <!-- Summary KPI strip (cover) -->
  <div style="margin:16px 40px 0;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:8px">Summary — ${escapeHtml(data.periodLabel)}</div>
    <div style="display:grid;grid-template-columns:repeat(6,1fr);border:0.5px solid #e5e7eb;border-radius:4px;overflow:hidden">
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Qty Sold</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtN(data.totals.qty)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Product Sales</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtD(data.totals.sales)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Total Cost</div>
        <div style="font-size:12px;font-weight:700;color:#666;font-family:monospace">${fmtD(data.totals.cost)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Product Net</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtD(data.totals.net)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">HPD Fee (${(data.feePct * 100).toFixed(1)}%)</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtD(data.totals.fee)}</div>
      </div>
      <div style="padding:10px 12px">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Net Profit</div>
        <div style="font-size:12px;font-weight:700;color:${data.totals.profit >= 0 ? "#2a7a3a" : "#b3263a"};font-family:monospace">${fmtD(data.totals.profit)}</div>
      </div>
    </div>
  </div>

  <!-- Amount due — invoice-standard right-aligned total. This is HPD's
       service fee only; product sales and cost flow through to the
       client (they collect the revenue, pay the unit cost, and HPD
       bills the service percentage on top). -->
  <div style="padding:20px 40px 24px;font-family:${font};display:flex;justify-content:flex-end">
    <div style="text-align:right;min-width:240px;padding-top:10px;border-top:1.5px solid #1a1a1a">
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px">Amount Due</div>
      <div style="font-size:9px;color:#999;font-weight:500;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em">${(data.feePct * 100).toFixed(0)}% Service Fee</div>
      <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#1a1a1a;font-family:monospace">${fmtD(data.totals.fee)}</div>
    </div>
  </div>

  <!-- Attachment / detail note -->
  <div style="padding:14px 40px;background:#f7f7f8;font-family:${font};font-size:10px;color:#666">
    A line-item breakdown of all product sales for this period appears on the following pages.
  </div>

  <!-- ============ PAGE BREAK — line-item report begins page 2 ============ -->
  <div style="page-break-before:always;break-before:page;height:0"></div>

  <!-- Page 2+ header (lighter, since the cover already establishes the doc) -->
  <div style="padding:24px 32px 14px;border-bottom:1.5px solid #111;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px">Sales Detail</div>
      <div style="font-size:14px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)} · ${escapeHtml(data.periodLabel)}</div>
    </div>
    <div style="font-size:10px;color:#888">${data.invoiceNumber ? `Invoice #${escapeHtml(data.invoiceNumber)} · ` : ""}${escapeHtml(data.generatedOn)}</div>
  </div>

  ${totalsStrip}

  <!-- Per-item stacked blocks -->
  <div style="padding:8px 32px 20px">
    <div style="font-size:7.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;padding:10px 0 2px">Line Items</div>
    ${rows}
  </div>

  ${totalsStrip}

  <!-- Footer -->
  <div style="padding:18px 32px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${data.branding.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${data.branding.fromEmailQuotes ? data.branding.fromEmailQuotes + "<br/>" : ""}${data.branding.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa;text-align:right;max-width:300px">Net Profit = Product Net − HPD Fee. Please remit the service fee via the Pay Online link in the accompanying email.</div>
  </div>

</div>
</body></html>`;
}

function renderPostageReportHTML(data: {
  clientName: string;
  clientBillingAddress: string | null;
  clientBillingEmail: string | null;
  periodLabel: string;
  generatedOn: string;
  markupPct: number;
  perPackageFee: number;
  invoiceNumber: string | null;
  lines: PostageLine[];
  totals: PostageTotals;
  branding: import("@/lib/branding").PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  const itemsFallback = data.lines.reduce((a, r) => a + (Number(r.items_count) || 0), 0);
  const safe = {
    shipments: Number(data.totals?.shipments) || 0,
    items: Number(data.totals?.items) || itemsFallback,
    paid: Number(data.totals?.paid) || 0,
    cost_raw: Number(data.totals?.cost_raw) || 0,
    cost: Number(data.totals?.cost) || 0,
    insurance: Number(data.totals?.insurance) || 0,
    billed: Number(data.totals?.billed) || 0,
    margin: Number(data.totals?.margin) || 0,
    fulfillment: Number(data.totals?.fulfillment) || 0,
  };
  const totalInvoice = safe.billed + safe.fulfillment;
  const hasFulfillment = safe.fulfillment > 0 || data.perPackageFee > 0;

  // KPI tiles — mirrors the 7-tile strip on the detail page so the
  // invoice view matches what Jon sees in OpsHub.
  const kpiTile = (label: string, value: string, valueColor?: string) =>
    `<div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">${escapeHtml(label)}</div>
      <div style="font-size:12px;font-weight:700;color:${valueColor || "#1a1a1a"};font-family:monospace">${escapeHtml(value)}</div>
    </div>`;
  const kpiTileLast = (label: string, value: string, valueColor?: string) =>
    `<div style="padding:10px 12px">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">${escapeHtml(label)}</div>
      <div style="font-size:12px;font-weight:700;color:${valueColor || "#1a1a1a"};font-family:monospace">${escapeHtml(value)}</div>
    </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <!-- Header -->
  <div style="padding:36px 40px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${data.branding.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          ${data.branding.headerAddressHtml}${data.branding.fromEmailQuotes ? "<br/>" + data.branding.fromEmailQuotes : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">
          FULFILLMENT INVOICE
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          ${data.invoiceNumber ? `<div><span style="font-weight:600">Invoice #:</span> ${escapeHtml(data.invoiceNumber)}</div>` : ""}
          <div><span style="font-weight:600">Date:</span> ${escapeHtml(data.generatedOn)}</div>
          <div><span style="font-weight:600">Period:</span> ${escapeHtml(data.periodLabel)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bill to -->
  <div style="padding:24px 40px 8px;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:6px">Bill To</div>
    <div style="font-size:15px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)}</div>
    ${data.clientBillingAddress ? `<div style="font-size:11px;color:#444;line-height:1.6;margin-top:4px;white-space:pre-line">${escapeHtml(data.clientBillingAddress)}</div>` : ""}
    ${data.clientBillingEmail ? `<div style="font-size:11px;color:#444;margin-top:4px">${escapeHtml(data.clientBillingEmail)}</div>` : ""}
  </div>

  <!-- KPI strip — matches the 8-tile view on the in-app detail page.
       Fulfillment fee is its own tile so the client can see HPD's
       service charge without it muddying their store's postage margin. -->
  <div style="margin:16px 40px 0;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:8px">Summary — ${escapeHtml(data.periodLabel)}</div>
    <div style="display:grid;grid-template-columns:repeat(8,1fr);border:0.5px solid #e5e7eb;border-radius:4px;overflow:hidden">
      ${kpiTile("Shipments", fmtN(safe.shipments))}
      ${kpiTile("Items Shipped", fmtN(safe.items))}
      ${kpiTile("Shipping Income", fmtD(safe.paid))}
      ${kpiTile("Shipping Cost", fmtD(safe.cost), "#666")}
      ${kpiTile("Insurance", fmtD(safe.insurance), "#666")}
      ${kpiTile("Billed Amount", fmtD(safe.billed))}
      ${kpiTile("Client Profit", fmtD(safe.margin), safe.margin >= 0 ? "#2a7a3a" : "#b3263a")}
      ${kpiTileLast("Fulfillment", fmtD(safe.fulfillment))}
    </div>
  </div>

  <!-- Invoice breakdown — postage line + fulfillment line + grand total.
       Right-aligned, invoice-standard. Fulfillment row only renders when
       there's a fee to charge so the older postage-only reports stay
       visually unchanged. -->
  <div style="padding:20px 40px 24px;font-family:${font};display:flex;justify-content:flex-end">
    <div style="min-width:340px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Postage Billed (cost + insurance)</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(safe.billed)}</span>
      </div>
      ${hasFulfillment ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Fulfillment Fee${data.perPackageFee > 0 ? ` (${fmtD(data.perPackageFee)} × ${fmtN(safe.shipments)} shipments)` : ""}</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(safe.fulfillment)}</span>
      </div>` : ""}
      <div style="padding-top:10px;margin-top:6px;border-top:1.5px solid #1a1a1a;display:flex;justify-content:space-between;align-items:baseline">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa">Amount Due</div>
        </div>
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#1a1a1a;font-family:monospace">${fmtD(totalInvoice)}</div>
      </div>
    </div>
  </div>

  <!-- Attachment note -->
  <div style="padding:16px 40px;background:#f7f7f8;font-family:${font};font-size:10px;color:#666">
    A detailed shipment-level spreadsheet is attached to this invoice (xlsx).
  </div>

  <!-- Footer -->
  <div style="padding:18px 40px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${data.branding.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${data.branding.fromEmailQuotes ? data.branding.fromEmailQuotes + "<br/>" : ""}${data.branding.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa;text-align:right;max-width:300px">Please remit payment via the Pay Online link in the accompanying email, or contact us at ${data.branding.fromEmailQuotes || "hello@housepartydistro.com"} with any questions.</div>
  </div>

</div>
</body></html>`;
}

// ── Combined ("Full Service") report PDF ──
// One invoice covering both halves of HPD's monthly fulfillment for a
// client. Layout mirrors single-type PDFs so every detail (totals strip
// chip rhythm, per-item blocks, footer copy) feels consistent:
//   Page 1 — cover with FULL SERVICE INVOICE title, Bill To, summary of
//            both halves, and an invoice breakdown that matches the QB
//            invoice (Service Fee + Postage + Fulfillment = Amount Due).
//   Page 2 — sales detail: 6-tile totals strip + per-item stacked blocks
//            + repeated totals strip footer. Same body the sales-only
//            PDF uses on its inside pages.
//   Page 3 — postage summary: 8-tile KPI strip + invoice breakdown +
//            note that the shipment Excel is attached.
function renderCombinedReportHTML(data: {
  clientName: string;
  clientBillingAddress: string | null;
  clientBillingEmail: string | null;
  invoiceNumber: string | null;
  periodLabel: string;
  generatedOn: string;
  feePct: number;
  markupPct: number;
  perPackageFee: number;
  salesLines: LineItem[];
  salesTotals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number };
  postageLines: PostageLine[];
  postageTotals: PostageTotals;
  branding: import("@/lib/branding").PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  const itemsFallback = data.postageLines.reduce((a, r) => a + (Number(r.items_count) || 0), 0);
  const post = {
    shipments: Number(data.postageTotals?.shipments) || 0,
    items: Number(data.postageTotals?.items) || itemsFallback,
    paid: Number(data.postageTotals?.paid) || 0,
    cost_raw: Number(data.postageTotals?.cost_raw) || 0,
    cost: Number(data.postageTotals?.cost) || 0,
    insurance: Number(data.postageTotals?.insurance) || 0,
    billed: Number(data.postageTotals?.billed) || 0,
    margin: Number(data.postageTotals?.margin) || 0,
    fulfillment: Number(data.postageTotals?.fulfillment) || 0,
  };
  const hasFulfillment = post.fulfillment > 0 || data.perPackageFee > 0;
  const totalDue = data.salesTotals.fee + post.billed + post.fulfillment;

  // Sales totals strip — same chip rhythm as the sales-only PDF so the
  // sales section of a combined PDF reads identically to a sales report.
  const salesTotalsStrip = `
    <div style="display:grid;grid-template-columns:repeat(6,1fr);border-top:0.5px solid #e5e7eb;border-bottom:0.5px solid #e5e7eb;font-family:${font}">
      ${[
        ["Qty Sold", fmtN(data.salesTotals.qty)],
        ["Product Sales", fmtD(data.salesTotals.sales)],
        ["Total Cost", fmtD(data.salesTotals.cost)],
        ["Product Net", fmtD(data.salesTotals.net)],
        [`HPD Fee (${(data.feePct * 100).toFixed(1)}%)`, fmtD(data.salesTotals.fee)],
        ["Net Profit", fmtD(data.salesTotals.profit)],
      ].map(([k, v], i, arr) =>
        `<div style="padding:12px 14px;${i < arr.length - 1 ? "border-right:0.5px solid #e5e7eb" : ""}">
          <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">${k}</div>
          <div style="font-size:13px;font-weight:700;color:#1a1a1a;font-family:monospace">${v}</div>
        </div>`
      ).join("")}
    </div>`;

  const groups = groupLineItems(data.salesLines);
  const numCell = (label: string, value: string, opts: { bold?: boolean } = {}) => `
    <div style="padding:0;white-space:nowrap;text-align:center">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:3px">${escapeHtml(label)}</div>
      <div style="font-size:${opts.bold ? 12 : 11}px;font-weight:${opts.bold ? 800 : 600};color:#1a1a1a;font-family:monospace">${escapeHtml(value)}</div>
    </div>`;
  const salesRows = groups.map(g => {
    const totalCost = g.unit_cost * g.qty_sold;
    const net = g.product_sales - totalCost;
    const fee = net * data.feePct;
    const profit = net - fee;
    const hasSizes = g.variants.length > 1 && g.variants.some(v => v.qty_sold > 0);
    const sizesLine = hasSizes
      ? g.variants
          .filter(v => v.qty_sold > 0)
          .map(v => `<span style="white-space:nowrap"><span style="color:#aaa;font-weight:600;margin-right:3px">${escapeHtml(v.size || v.sku)}</span>${fmtN(v.qty_sold)}</span>`)
          .join(`<span style="color:#ccc;margin:0 9px">·</span>`)
      : "";
    return `
    <div style="padding:10px 0 14px;border-bottom:0.5px solid #eeeeee;font-family:${font};page-break-inside:avoid;break-inside:avoid">
      <div style="display:grid;grid-template-columns:repeat(6,1fr);gap:0 10px;align-items:baseline">
        <div style="grid-column:1 / 6;min-width:0;white-space:nowrap;overflow:visible">
          <span style="font-size:13px;font-weight:700;color:#1a1a1a;letter-spacing:-0.005em">${escapeHtml(g.root_description || "—")}</span>
          <span style="font-family:monospace;font-size:9px;color:#aaa;font-weight:500;margin-left:8px">${escapeHtml(g.root_sku || "—")}</span>
        </div>
        <div style="grid-column:6;text-align:center;white-space:nowrap">
          <span style="color:#999;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;font-size:9px;margin-right:6px">Qty</span>
          <span style="color:#1a1a1a;font-weight:700;font-family:monospace;font-size:13px">${fmtN(g.qty_sold)}</span>
        </div>
      </div>
      ${hasSizes ? `
      <div style="margin-top:4px;font-family:monospace;font-size:10px;color:#666;line-height:1.5;white-space:nowrap;overflow:visible">
        ${sizesLine}
      </div>` : ""}
      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(6,1fr);gap:0 10px">
        ${numCell("Sales", fmtD(g.product_sales))}
        ${numCell("Unit Cost", fmtD(g.unit_cost))}
        ${numCell("Total Cost", fmtD(totalCost))}
        ${numCell("Net", fmtD(net))}
        ${numCell("HPD Fee", fmtD(fee))}
        ${numCell("Profit", fmtD(profit), { bold: true })}
      </div>
    </div>`;
  }).join("");

  // Postage 8-tile KPI strip — same as postage-only PDF.
  const kpiTile = (label: string, value: string, valueColor?: string) =>
    `<div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">${escapeHtml(label)}</div>
      <div style="font-size:12px;font-weight:700;color:${valueColor || "#1a1a1a"};font-family:monospace">${escapeHtml(value)}</div>
    </div>`;
  const kpiTileLast = (label: string, value: string, valueColor?: string) =>
    `<div style="padding:10px 12px">
      <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">${escapeHtml(label)}</div>
      <div style="font-size:12px;font-weight:700;color:${valueColor || "#1a1a1a"};font-family:monospace">${escapeHtml(value)}</div>
    </div>`;

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:1040px;margin:0 auto">

  <!-- ============ COVER PAGE — Full Service Invoice ============ -->
  <div style="padding:36px 40px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${data.branding.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          ${data.branding.headerAddressHtml}${data.branding.fromEmailQuotes ? "<br/>" + data.branding.fromEmailQuotes : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">
          FULL SERVICE INVOICE
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          ${data.invoiceNumber ? `<div><span style="font-weight:600">Invoice #:</span> ${escapeHtml(data.invoiceNumber)}</div>` : ""}
          <div><span style="font-weight:600">Date:</span> ${escapeHtml(data.generatedOn)}</div>
          <div><span style="font-weight:600">Period:</span> ${escapeHtml(data.periodLabel)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Bill to -->
  <div style="padding:24px 40px 8px;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:6px">Bill To</div>
    <div style="font-size:15px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)}</div>
    ${data.clientBillingAddress ? `<div style="font-size:11px;color:#444;line-height:1.6;margin-top:4px;white-space:pre-line">${escapeHtml(data.clientBillingAddress)}</div>` : ""}
    ${data.clientBillingEmail ? `<div style="font-size:11px;color:#444;margin-top:4px">${escapeHtml(data.clientBillingEmail)}</div>` : ""}
  </div>

  <!-- Combined summary KPIs — 4 tiles covering both halves at a glance.
       Sales contributes Qty + Service Fee; postage contributes
       Shipments + Total Postage Billed. Profit / margin tiles live
       on the per-section pages. -->
  <div style="margin:16px 40px 0;font-family:${font}">
    <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#999;margin-bottom:8px">Summary — ${escapeHtml(data.periodLabel)}</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);border:0.5px solid #e5e7eb;border-radius:4px;overflow:hidden">
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Units Sold</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtN(data.salesTotals.qty)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Product Sales</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtD(data.salesTotals.sales)}</div>
      </div>
      <div style="padding:10px 12px;border-right:0.5px solid #e5e7eb">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Shipments</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtN(post.shipments)}</div>
      </div>
      <div style="padding:10px 12px">
        <div style="font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:3px;white-space:nowrap">Items Shipped</div>
        <div style="font-size:12px;font-weight:700;color:#1a1a1a;font-family:monospace">${fmtN(post.items)}</div>
      </div>
    </div>
  </div>

  <!-- Invoice breakdown — exact line items the QB invoice contains. -->
  <div style="padding:20px 40px 8px;font-family:${font};display:flex;justify-content:flex-end">
    <div style="min-width:380px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Service Fee (${(data.feePct * 100).toFixed(1)}% of ${fmtD(data.salesTotals.net)} net sales)</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(data.salesTotals.fee)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Postage &amp; Insurance</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(post.billed)}</span>
      </div>
      ${hasFulfillment ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Fulfillment Fee${data.perPackageFee > 0 ? ` (${fmtD(data.perPackageFee)} × ${fmtN(post.shipments)} shipments)` : ""}</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(post.fulfillment)}</span>
      </div>` : ""}
      <div style="padding-top:10px;margin-top:6px;border-top:1.5px solid #1a1a1a;display:flex;justify-content:space-between;align-items:baseline">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa">Amount Due</div>
        </div>
        <div style="font-size:22px;font-weight:800;letter-spacing:-0.02em;color:#1a1a1a;font-family:monospace">${fmtD(totalDue)}</div>
      </div>
    </div>
  </div>

  <!-- Attachment / detail note -->
  <div style="padding:14px 40px;background:#f7f7f8;font-family:${font};font-size:10px;color:#666">
    A line-item product breakdown follows on page 2. The shipment-level postage spreadsheet is attached as xlsx.
  </div>

  <!-- ============ PAGE BREAK — sales detail begins page 2 ============ -->
  <div style="page-break-before:always;break-before:page;height:0"></div>

  <div style="padding:24px 32px 14px;border-bottom:1.5px solid #111;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px">Sales Detail</div>
      <div style="font-size:14px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)} · ${escapeHtml(data.periodLabel)}</div>
    </div>
    <div style="font-size:10px;color:#888">${data.invoiceNumber ? `Invoice #${escapeHtml(data.invoiceNumber)} · ` : ""}${escapeHtml(data.generatedOn)}</div>
  </div>

  ${salesTotalsStrip}

  <div style="padding:8px 32px 20px">
    <div style="font-size:7.5px;font-weight:600;text-transform:uppercase;letter-spacing:0.1em;color:#bbb;padding:10px 0 2px">Line Items</div>
    ${salesRows}
  </div>

  ${salesTotalsStrip}

  <!-- Service fee subtotal — mirrors the postage subtotal block on
       page 3 so the sales section closes with a clear bold figure
       (the only sales-side line item on the QB invoice) instead of
       leaving the reader to spot it inside the KPI strip. -->
  <div style="padding:20px 40px 24px;font-family:${font};display:flex;justify-content:flex-end">
    <div style="min-width:340px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>HPD Service Fee (${(data.feePct * 100).toFixed(1)}% of ${fmtD(data.salesTotals.net)} net sales)</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(data.salesTotals.fee)}</span>
      </div>
      <div style="padding-top:10px;margin-top:6px;border-top:1.5px solid #1a1a1a;display:flex;justify-content:space-between;align-items:baseline">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa">Service Fee Subtotal</div>
        </div>
        <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#1a1a1a;font-family:monospace">${fmtD(data.salesTotals.fee)}</div>
      </div>
    </div>
  </div>

  <!-- ============ PAGE BREAK — postage section begins ============ -->
  <div style="page-break-before:always;break-before:page;height:0"></div>

  <div style="padding:24px 32px 14px;border-bottom:1.5px solid #111;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px">Postage Summary</div>
      <div style="font-size:14px;font-weight:700;color:#1a1a1a">${escapeHtml(data.clientName)} · ${escapeHtml(data.periodLabel)}</div>
    </div>
    <div style="font-size:10px;color:#888">${data.invoiceNumber ? `Invoice #${escapeHtml(data.invoiceNumber)} · ` : ""}${escapeHtml(data.generatedOn)}</div>
  </div>

  <div style="margin:16px 40px 0;font-family:${font}">
    <div style="display:grid;grid-template-columns:repeat(8,1fr);border:0.5px solid #e5e7eb;border-radius:4px;overflow:hidden">
      ${kpiTile("Shipments", fmtN(post.shipments))}
      ${kpiTile("Items Shipped", fmtN(post.items))}
      ${kpiTile("Shipping Income", fmtD(post.paid))}
      ${kpiTile("Shipping Cost", fmtD(post.cost), "#666")}
      ${kpiTile("Insurance", fmtD(post.insurance), "#666")}
      ${kpiTile("Billed Amount", fmtD(post.billed))}
      ${kpiTile("Client Profit", fmtD(post.margin), post.margin >= 0 ? "#2a7a3a" : "#b3263a")}
      ${kpiTileLast("Fulfillment", fmtD(post.fulfillment))}
    </div>
  </div>

  <div style="padding:20px 40px 24px;font-family:${font};display:flex;justify-content:flex-end">
    <div style="min-width:340px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Postage Billed (cost + insurance)</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(post.billed)}</span>
      </div>
      ${hasFulfillment ? `
      <div style="display:flex;justify-content:space-between;align-items:baseline;font-size:11px;color:#666;padding:6px 0">
        <span>Fulfillment Fee${data.perPackageFee > 0 ? ` (${fmtD(data.perPackageFee)} × ${fmtN(post.shipments)} shipments)` : ""}</span>
        <span style="font-family:monospace;font-weight:600;color:#1a1a1a">${fmtD(post.fulfillment)}</span>
      </div>` : ""}
      <div style="padding-top:10px;margin-top:6px;border-top:1.5px solid #1a1a1a;display:flex;justify-content:space-between;align-items:baseline">
        <div>
          <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa">Postage Subtotal</div>
        </div>
        <div style="font-size:18px;font-weight:800;letter-spacing:-0.02em;color:#1a1a1a;font-family:monospace">${fmtD(post.billed + post.fulfillment)}</div>
      </div>
    </div>
  </div>

  <div style="padding:16px 40px;background:#f7f7f8;font-family:${font};font-size:10px;color:#666">
    A detailed shipment-level spreadsheet is attached to this invoice (xlsx).
  </div>

  <!-- Footer -->
  <div style="padding:18px 40px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${data.branding.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${data.branding.fromEmailQuotes ? data.branding.fromEmailQuotes + "<br/>" : ""}${data.branding.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa;text-align:right;max-width:300px">Please remit payment via the Pay Online link in the accompanying email, or contact us at ${data.branding.fromEmailQuotes || "hello@housepartydistro.com"} with any questions.</div>
  </div>

</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return (s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const portalToken = req.nextUrl.searchParams.get("portal");

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Portal-token auth: client portal uses ?portal=TOKEN. We match the
  // token to a client and verify the report belongs to that client — so
  // a FOG token can only download FOG's reports.
  let portalAuth = false;
  if (!internal && portalToken) {
    const { data: tokenClient } = await supabase
      .from("clients")
      .select("id")
      .eq("portal_token", portalToken)
      .single();
    if (tokenClient) {
      const { data: r } = await supabase
        .from("shipstation_reports")
        .select("id")
        .eq("id", params.id)
        .eq("client_id", tokenClient.id)
        .single();
      portalAuth = !!r;
    }
  }

  if (!internal && !portalAuth) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { data: report, error } = await supabase
      .from("shipstation_reports")
      .select("*, clients(name, billing_address)")
      .eq("id", params.id)
      .single();
    if (error || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const clientName = (report.clients as any)?.name || "—";
    const clientBillingAddress = (report.clients as any)?.billing_address || null;
    const generatedOn = new Date(report.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const isPostage = report.report_type === "postage";
    const isCombined = report.report_type === "combined";

    // Pick bill-to email. Convention in OpsHub: client contacts are
    // labeled by actual role (Owner, Manager, etc.). Owner pays the
    // bills. Managers on a client record are usually the HPD-internal
    // account lead and must not receive the bill. Used by all report
    // types since they all render an invoice-style cover page.
    const { data: contacts } = await supabase
      .from("contacts")
      .select("email, role_label")
      .eq("client_id", report.client_id);
    const branding = await getPdfBranding();
    const tenantEmailDomain = (branding.fromEmailQuotes || "").split("@")[1] || "housepartydistro.com";
    const contactList = (contacts || []) as Array<{ email: string | null; role_label: string | null }>;
    const externalContacts = contactList.filter(c => c.email && !new RegExp(`@${tenantEmailDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i").test(c.email));
    const ownerContact = externalContacts.find(c => (c.role_label || "").toLowerCase().includes("owner"));
    const clientBillingEmail: string | null = (ownerContact || externalContacts[0])?.email || null;

    const html = isCombined
      ? renderCombinedReportHTML({
          clientName,
          clientBillingAddress,
          clientBillingEmail,
          invoiceNumber: report.qb_invoice_number || null,
          periodLabel: report.period_label,
          generatedOn,
          feePct: Number(report.hpd_fee_pct) || 0,
          markupPct: Number((report as any).postage_markup_pct) || 0,
          perPackageFee: Number((report as any).per_package_fee) || 0,
          salesLines: (report.line_items || []) as LineItem[],
          salesTotals: report.totals || { qty: 0, sales: 0, cost: 0, net: 0, fee: 0, profit: 0 },
          postageLines: ((report as any).postage_line_items || []) as PostageLine[],
          postageTotals: ((report as any).postage_totals || { shipments: 0, items: 0, paid: 0, cost_raw: 0, cost: 0, insurance: 0, billed: 0, margin: 0 }) as PostageTotals,
          branding,
        })
      : isPostage
      ? renderPostageReportHTML({
          clientName,
          clientBillingAddress,
          clientBillingEmail,
          periodLabel: report.period_label,
          generatedOn,
          markupPct: Number(report.hpd_fee_pct) || 0,
          perPackageFee: Number((report as any).per_package_fee) || 0,
          invoiceNumber: report.qb_invoice_number || null,
          lines: (report.line_items || []) as PostageLine[],
          totals: (report.totals || { shipments: 0, items: 0, paid: 0, cost_raw: 0, cost: 0, insurance: 0, billed: 0, margin: 0 }) as PostageTotals,
          branding,
        })
      : renderSalesReportHTML({
          clientName,
          clientBillingAddress,
          clientBillingEmail,
          invoiceNumber: report.qb_invoice_number || null,
          periodLabel: report.period_label,
          generatedOn,
          feePct: Number(report.hpd_fee_pct) || 0,
          lines: (report.line_items || []) as LineItem[],
          totals: report.totals || { qty: 0, sales: 0, cost: 0, net: 0, fee: 0, profit: 0 },
          branding,
        });

    const pdfBuffer = await generatePDF(html);
    const slug = (clientName + "-" + report.period_label).replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `HPD-${isCombined ? "Full-Service-Invoice" : isPostage ? "Fulfillment-Invoice" : "Services-Invoice"}-${slug}.pdf`;

    const isDownload = req.nextUrl.searchParams.get("download");
    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF ShipStation Report Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
