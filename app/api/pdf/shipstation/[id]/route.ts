export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { groupLineItems } from "@/lib/shipstation-group";

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtN = (n: number) => Number(n || 0).toLocaleString("en-US");

// HPD logo — same SVG used on the invoice PDF for consistency.
const HPD_LOGO_SVG = `<svg style="height:32px;display:block;margin-bottom:10px" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 227.14 28.53"><g><path fill="#000000" d="M15.48,14.1v8.5c0,.13-.11.24-.24.24h-4.51c-.13,0-.24-.11-.24-.24v-8.27c0-.56-.03-1.2-.27-1.72-.11-.22-.25-.4-.42-.54-.28-.22-.65-.33-1.12-.33-.87,0-1.54.3-1.76.78-.24.52-.24,1.24-.24,1.81v8.27c0,.13-.11.24-.24.24H1.93c-.13,0-.24-.11-.24-.24V3.21c0-.13.11-.24.24-.24h4.22c.13,0,.24.11.24.24v5.17c0,.1.11.15.19.1,3.4-2.34,6.72.26,6.75.29.12.09.24.2.34.3h0c1.54,1.55,1.8,2.81,1.8,5.03Z"/><path fill="#000000" d="M31.55,15.4c0,4.36-3.6,7.91-8.02,7.91s-8.02-3.55-8.02-7.91,3.6-7.91,8.02-7.91,8.02,3.55,8.02,7.91ZM27.02,15.4c0-1.9-1.57-3.45-3.5-3.45s-3.5,1.55-3.5,3.45,1.57,3.45,3.5,3.45,3.5-1.55,3.5-3.45Z"/><path fill="#000000" d="M45.34,7.97v14.63c0,.13-.11.24-.24.24h-4.22c-.13,0-.24-.11-.24-.24v-.41c0-.1-.11-.15-.19-.1-1.06.73-2.1.98-3.04.98-2.1,0-3.68-1.24-3.71-1.26-.12-.09-.24-.2-.34-.3h0c-1.54-1.55-1.8-2.81-1.8-5.03V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24v8.27c0,.56.03,1.2.27,1.72.11.22.25.4.42.54.28.22.65.33,1.12.33.87,0,1.54-.3,1.76-.78.24-.52.24-1.24.24-1.81V7.97c0-.13.11-.24.24-.24h4.51c.13,0,.24.11.24.24Z"/><path fill="#000000" d="M57.67,18.33c-.04.53-.17,1.09-.41,1.67-.9,1.93-2.99,3.07-5.59,3.07-.36,0-.73-.02-1.1-.07-1.17-.14-2.19-.45-3.04-.92-.87-.59-1.54-1.42-1.99-2.46-.06-.14.02-.3.17-.33l4.14-.89c.1-.02.2.02.25.1.29.43.78.64,1.05.68.63.08.96-.09,1.13-.25.17-.16.24-.37.21-.6-.07-.52-.38-.77-1.98-1.53h-.02c-.32-.16-.72-.35-1.16-.57-.31-.13-.6-.28-.88-.42h-.02s-.08-.06-.12-.08c-1.44-.82-2.28-1.83-2.49-2.98-.31-1.65.75-3.05.97-3.31.32-.36.69-.68,1.11-.95,1.26-.8,2.88-1.13,4.56-.94,1.01.12,1.93.39,2.73.81.38.2.73.43,1.05.7.22.19.89.86,1.1,1.89.03.13-.06.26-.19.28l-4.07.82c-.12.02-.23-.04-.27-.15-.11-.28-.37-.57-.9-.63-.36-.04-.68.06-.89.29-.16.17-.22.39-.17.56.08.27.36.7,1.88,1.32.3.12.58.23.86.34.35.13.7.26,1.02.4h0c.97.45,3.21,1.76,3.07,4.15Z"/><path fill="#000000" d="M73.45,15.4c0,.44-.05.95-.13,1.4-.02.12-.12.2-.24.2h-10.58c-.19,0-.3.2-.21.37.65,1.1,1.81,1.79,3.1,1.79,1.09,0,2.11-.48,2.84-1.41.06-.07.15-.11.23-.09l4.05.73c.16.03.24.2.18.34-.09.19-.21.43-.27.54h0c-.06.1-.13.21-.2.32-.09.14-.18.27-.27.38l-.05.07c-.06.07-.11.13-.17.2l-.05.06c-.09.1-.18.2-.28.3l-.05.06c-.06.06-.13.13-.19.19l-.02.02c-.07.07-.14.13-.22.2l-.08.07c-.11.1-.22.18-.33.26l-.09.07c-.12.09-.25.18-.38.26l-.04.02c-.15.1-.3.19-.45.27l-.04.02s-.07.04-.11.06h-.03c-.07.05-.13.08-.2.11l-.04.02c-.14.07-.28.13-.41.18h-.03l-.25.11-.1.04-.3.1h-.02l-.35.11-.09.02c-.23.06-.46.1-.69.14h-.09c-.24.05-.48.07-.72.09h-.09l-.37.01-.37,0c-.03,0-.06,0-.08,0h-.03l-.27-.02h-.03s-.05,0-.08,0c-.13-.01-.25-.03-.35-.04h0l-.1-.02-.45-.08-.16-.03-.4-.09h-.04s-.05-.02-.08-.03c-.13-.03-.24-.06-.34-.1l-.34-.11c-.03,0-.05-.02-.08-.03h-.02l-.24-.1h-.02s-.05-.03-.07-.04l-.32-.14h-.01l-.3-.16c-.02-.01-.05-.03-.07-.04h-.02l-.22-.14-.09-.05-.29-.18c-.96-.64-1.78-1.49-2.38-2.46l-.15-.25-.02-.04-.13-.24-.02-.05s-.03-.05-.04-.07c-.15-.31-.29-.64-.4-.98l-.15-.5-.09-.38c-.08-.39-.13-.79-.15-1.19l-.01-.41,0-.41c.04-.7.17-1.4.39-2.07l.23-.6.14-.31c.01-.02.02-.05.04-.07l.03-.06s.02-.05.04-.07l.04-.07.07-.13c.06-.1.11-.2.17-.3.6-.97,1.42-1.82,2.38-2.46l.29-.18.09-.05.22-.13h.02s.05-.04.07-.05l.31-.16.32-.14c.02-.01.05-.02.07-.03h.02l.24-.1h.02s.05-.03.08-.04l.33-.11.34-.1c.02,0,.05-.01.08-.02h.03l.26-.07h.06l.38-.08h.02l.35-.04c.03,0,.05,0,.08,0h.03l.27-.02h.02s.06,0,.09,0l.37,0,.37,0h.09l.72.08h.1l.68.15.1.03.34.1h.02l.3.11.09.03.25.1.04.02.41.18.04.02.19.1h.02l.49.29h.02l.4.28.02.02s.05.04.08.06l.33.26.06.05.25.22.02.02.19.19.05.05.28.3.04.05.16.19.05.06.18.23h0l.14.21.09.13.11.18.15.25h0c.3.52.54,1.08.7,1.64.22.73.33,1.48.33,2.23ZM68.72,13.4c-.19-1.11-1.48-1.98-3.11-1.98-1.49,0-2.9.86-3.11,1.98-.03.15.09.29.24.29h5.75c.15,0,.26-.14.24-.28Z"/></g><g><path fill="#000000" d="M96.76,14.82c0,4.68-3.86,8.48-8.6,8.48-1.5,0-2.97-.39-4.27-1.12-.09-.05-.19.01-.19.11v5.59c0,.14-.12.26-.26.26h-4.52c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.49c0,.1.11.16.19.11,1.3-.73,2.76-1.12,4.27-1.12,4.74,0,8.6,3.8,8.6,8.48ZM91.33,14.82c0-2.14-1.77-3.89-3.94-3.89s-3.68,1.74-3.68,3.89,1.51,3.89,3.68,3.89,3.94-1.74,3.94-3.89Z"/><path fill="#000000" d="M114.9,6.85v15.68c0,.14-.12.26-.26.26h-4.53c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.19-.11-1.3.73-2.76,1.12-4.27,1.12-4.74,0-8.6-3.8-8.6-8.48s3.86-8.48,8.6-8.48c1.5,0,2.97.39,4.27,1.12.09.05.19-.01.19-.11v-.49c0-.14.12-.26.26-.26h4.53c.14,0,.26.12.26.26ZM109.86,14.82c0-2.14-1.51-3.89-3.68-3.89s-3.94,1.74-3.94,3.89,1.77,3.89,3.94,3.89,3.68-1.74,3.68-3.89Z"/><path fill="#000000" d="M124.28,6.87l-.15,3.79c0,.15-.13.26-.28.25-.44-.04-1.33-.1-1.85.03-.58.14-.92.59-1.02.81-.26.56-.26,1.06-.26,1.68v9.11c0,.14-.12.26-.26.26h-4.83c-.14,0-.26-.12-.26-.26V6.86c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v.45c0,.1.11.16.2.11,1.07-.67,2.34-.81,3.41-.82.15,0,.27.12.26.27Z"/><path fill="#000000" d="M134.26,18.88l-.58,3.83c-.02.12-.12.21-.24.22-.56.03-2.04.12-2.49.12-.04,0-.07,0-.09,0-2.75-.14-4.2-1.56-4.2-4.08v-7.77c0-.14-.12-.26-.26-.26h-1.68c-.14,0-.26-.12-.26-.26v-3.83c0-.14.12-.26.26-.26h1.68c.14,0,.26-.12.26-.26V1.88c0-.14.12-.26.26-.26h4.52c.14,0,.26.12.26.26v4.44c0,.14.12.26.26.26h1.68c.14,0,.26.12.26.26v3.83c0,.14-.12.26-.26.26h-1.68c-.14,0-.26.11-.26.26,0,1.34,0,5.32,0,5.36v.11c-.02.49-.04,1.17.35,1.57.23.24.59.36,1.07.36h.88c.16,0,.28.14.26.3Z"/><path fill="#000000" d="M150.4,6.95l-5.1,14.17-2.37,6.74c-.04.1-.13.17-.24.17h-5.03c-.18,0-.3-.17-.25-.34l1.97-5.84c.02-.06.02-.12,0-.17l-5.39-14.72c-.06-.17.06-.35.24-.35h4.51c.11,0,.21.07.24.17l2.95,7.98c.08.23.41.22.49,0l2.72-7.97c.04-.1.13-.18.25-.18h4.77c.18,0,.3.18.24.35Z"/><path fill="#000000" d="M171.26,1.54v21.08c0,.15-.12.26-.26.26h-4.59c-.14,0-.26-.12-.26-.26v-.24c0-.1-.11-.16-.2-.11-1.32.74-2.8,1.14-4.33,1.14-4.81,0-8.72-3.86-8.72-8.6s3.91-8.6,8.72-8.6c1.53,0,3.01.39,4.33,1.13.09.05.2-.01.2-.11V1.54c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26ZM166.14,14.79c0-2.18-1.53-3.95-3.74-3.95s-4,1.77-4,3.95,1.79,3.95,4,3.95,3.74-1.77,3.74-3.95Z"/><path fill="#000000" d="M176.51,6.46h-4.59c-.15,0-.26.12-.26.26v15.9c0,.14.12.26.26.26h4.59c.15,0,.26-.12.26-.26V6.72c0-.15-.12-.26-.26-.26ZM176.71,1.38s0-.02-.02-.02c-1.55-.11-5.01,2.17-4.97,3.72,0,0,.01.01.02.02.04.04.11.07.17.07h4.59c.15,0,.26-.12.26-.26V1.54c0-.06-.02-.12-.06-.17Z"/><path fill="#000000" d="M189.79,17.99c-.04.57-.19,1.19-.44,1.82-.98,2.09-3.25,3.34-6.08,3.34-.39,0-.79-.02-1.19-.07-1.27-.15-2.38-.49-3.3-1.01-.95-.64-1.67-1.54-2.16-2.67-.07-.15.02-.33.19-.36l4.5-.97c.11-.02.21.02.27.11.32.47.85.7,1.14.73.69.08,1.05-.1,1.22-.27.18-.17.26-.4.23-.66-.07-.57-.41-.83-2.15-1.66h-.02c-.35-.18-.78-.38-1.26-.62-.33-.14-.66-.3-.96-.46l-.03-.02s-.09-.05-.13-.08c-1.56-.9-2.47-1.99-2.71-3.24-.34-1.79.82-3.31,1.05-3.6.35-.39.75-.74,1.21-1.03,1.37-.87,3.13-1.23,4.96-1.02,1.1.13,2.1.43,2.96.88.41.22.8.47,1.14.76.24.21.97.94,1.2,2.05.03.14-.07.28-.21.31l-4.43.9c-.13.02-.25-.05-.29-.16-.12-.31-.4-.62-.98-.69-.39-.05-.74.07-.96.32-.17.19-.24.42-.19.61.08.29.39.76,2.04,1.44.33.13.63.24.93.37.38.14.76.29,1.11.44h0c1.05.49,3.48,1.92,3.34,4.51Z"/><path fill="#000000" d="M199.29,18.92l-.59,3.89c-.02.12-.12.22-.24.22-.56.03-2.07.12-2.53.12-.04,0-.07,0-.09,0-2.79-.15-4.26-1.58-4.26-4.14v-7.89c0-.14-.12-.26-.26-.26h-1.71c-.14,0-.26-.12-.26-.26v-3.89c0-.14.12-.26.26-.26h1.71c.14,0,.26-.12.26-.26V1.67c0-.14.12-.26.26-.26h4.59c.14,0,.26.12.26.26v4.51c0,.14.12.26.26.26h1.71c.14,0,.26.12.26.26v3.89c0,.14-.12.26-.26.26h-1.71c-.14,0-.26.12-.26.26,0,1.36,0,5.39,0,5.44v.11c-.02.5-.04,1.18.36,1.59.23.24.6.36,1.09.36h.89c.16,0,.28.14.26.3Z"/><path fill="#000000" d="M208.56,6.73l-.16,3.84c0,.15-.14.26-.29.25-.45-.04-1.35-.1-1.88.03-.59.14-.93.6-1.03.82-.27.57-.27,1.07-.27,1.71v9.25c0,.14-.12.26-.26.26h-4.9c-.15,0-.26-.12-.26-.26V6.72c0-.14.12-.26.26-.26h4.59c.15,0,.26.12.26.26v.46c0,.1.11.17.2.11,1.09-.68,2.38-.82,3.46-.83.15,0,.27.12.27.27Z"/><path fill="#000000" d="M225.19,14.8c0,4.74-3.91,8.6-8.72,8.6s-8.72-3.86-8.72-8.6,3.91-8.6,8.72-8.6,8.72,3.86,8.72,8.6ZM220.27,14.8c0-2.07-1.71-3.75-3.8-3.75s-3.8,1.68-3.8,3.75,1.71,3.75,3.8,3.75,3.8-1.68,3.8-3.75Z"/></g></svg>`;

type LineItem = { sku: string; description: string; qty_sold: number; product_sales: number; unit_cost: number };

function renderReportHTML(data: {
  clientName: string;
  periodLabel: string;
  generatedOn: string;
  feePct: number;
  lines: LineItem[];
  totals: { qty: number; sales: number; cost: number; net: number; fee: number; profit: number };
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  // Collapse size variants into one row per product. Sizes appear as a
  // compact subtitle under the product name so the detail stays visible
  // without blowing the report up to 4 pages.
  const groups = groupLineItems(data.lines);
  const rows = groups.map(g => {
    const totalCost = g.unit_cost * g.qty_sold;
    const net = g.product_sales - totalCost;
    const fee = net * data.feePct;
    const profit = net - fee;
    const sizesLine = g.variants.length > 1
      ? g.variants
          .filter(v => v.qty_sold > 0)
          .map(v => `<span style="white-space:nowrap">${escapeHtml(v.size || v.sku)}: ${fmtN(v.qty_sold)}</span>`)
          .join(" &nbsp;·&nbsp; ")
      : "";
    return `<tr style="border-bottom:0.5px solid #eeeeee;vertical-align:top">
      <td style="padding:10px 6px;font-family:monospace;font-size:10px;color:#888;font-weight:600;vertical-align:top">${escapeHtml(g.root_sku || "—")}</td>
      <td style="padding:10px 6px;font-size:11px;color:#1a1a1a;vertical-align:top">
        <div style="font-weight:600">${escapeHtml(g.root_description || "—")}</div>
        ${sizesLine ? `<div style="margin-top:3px;font-size:9.5px;color:#888;line-height:1.6">${sizesLine}</div>` : ""}
      </td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#1a1a1a;vertical-align:top">${fmtN(g.qty_sold)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#1a1a1a;vertical-align:top">${fmtD(g.product_sales)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#666;vertical-align:top">${fmtD(g.unit_cost)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#666;vertical-align:top">${fmtD(totalCost)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#1a1a1a;vertical-align:top">${fmtD(net)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#666;vertical-align:top">${fmtD(fee)}</td>
      <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:10.5px;color:#1a1a1a;font-weight:700;vertical-align:top">${fmtD(profit)}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:1040px;margin:0 auto">

  <!-- Header -->
  <div style="padding:28px 32px 20px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${HPD_LOGO_SVG}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          4670 W Silverado Ranch Blvd, STE 120<br/>Las Vegas, NV 89139<br/>hello@housepartydistro.com
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:6px">
          PRODUCT SALES REPORT
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          <div><span style="font-weight:600">Client:</span> ${escapeHtml(data.clientName)}</div>
          <div><span style="font-weight:600">Period:</span> ${escapeHtml(data.periodLabel)}</div>
          <div><span style="font-weight:600">Generated:</span> ${escapeHtml(data.generatedOn)}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Totals strip -->
  <div style="display:grid;grid-template-columns:repeat(6,1fr);border-bottom:0.5px solid #e5e7eb;font-family:${font}">
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
  </div>

  <!-- Items table -->
  <div style="padding:20px 32px">
    <table style="width:100%;border-collapse:collapse;font-family:${font}">
      <thead>
        <tr style="border-bottom:1.5px solid #1a1a1a">
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;padding:8px 6px">SKU</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:left;padding:8px 6px">Description</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Qty Sold</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Product Sales</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Unit Cost</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Total Cost</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Product Net</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">HPD Fee</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.08em;text-align:right;padding:8px 6px">Net Profit</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr style="border-top:1.5px solid #1a1a1a">
          <td colspan="2" style="padding:10px 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#1a1a1a">Totals</td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:700">${fmtN(data.totals.qty)}</td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:700">${fmtD(data.totals.sales)}</td>
          <td style="padding:10px 6px"></td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:700">${fmtD(data.totals.cost)}</td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:700">${fmtD(data.totals.net)}</td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:700">${fmtD(data.totals.fee)}</td>
          <td style="padding:10px 6px;text-align:right;font-family:monospace;font-size:11px;font-weight:800;color:#1a1a1a">${fmtD(data.totals.profit)}</td>
        </tr>
      </tfoot>
    </table>
  </div>

  <!-- Footer -->
  <div style="padding:18px 32px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">House Party Distro</div>
      <div style="font-size:10px;color:#666;line-height:1.8">hello@housepartydistro.com<br/>4670 W Silverado Ranch Blvd, STE 120<br/>Las Vegas, NV 89139</div>
    </div>
    <div style="font-size:9px;color:#aaa">Net Profit = Product Net − HPD Fee.</div>
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
      .select("*, clients(name)")
      .eq("id", params.id)
      .single();
    if (error || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const clientName = (report.clients as any)?.name || "—";
    const generatedOn = new Date(report.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const html = renderReportHTML({
      clientName,
      periodLabel: report.period_label,
      generatedOn,
      feePct: Number(report.hpd_fee_pct) || 0,
      lines: (report.line_items || []) as LineItem[],
      totals: report.totals || { qty: 0, sales: 0, cost: 0, net: 0, fee: 0, profit: 0 },
    });

    const pdfBuffer = await generatePDF(html);
    const slug = (clientName + "-" + report.period_label).replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `HPD-Sales-Report-${slug}.pdf`;

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
