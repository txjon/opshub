export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding, type PdfBranding } from "@/lib/branding";

// Pricing source of truth: items.sell_per_unit (set by CostingTab, rounded to cent)

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });


const TERMS_LABELS: Record<string, string> = {
  prepaid: "Prepaid",
  deposit_balance: "50% Deposit / Balance",
  net_15: "Net 15",
  net_30: "Net 30",
};

function renderInvoiceHTML(data: {
  invoiceNum: string; today: string; terms: string; shipDate: string;
  clientName: string; shipToAddress: string; notes: string;
  prods: { name: string; style: string; color: string; sizes: string[]; qtys: Record<string,number>; totalQty: number; sellPerUnit: number; grossRev: number; }[];
  quoteTotal: number; taxAmount: number; totalPaid: number; balanceDue: number;
  branding: PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  const itemRows = data.prods.map((p, pi) => {
    const activeSizes = (p.sizes || []).filter(sz => (p.qtys?.[sz] || 0) > 0);
    const sizeGrid = activeSizes.map(sz =>
      `<div style="font-size:10px;color:#444;font-family:monospace;white-space:nowrap"><span style="color:#999;margin-right:3px">${sz}</span>${p.qtys[sz].toLocaleString()}</div>`
    ).join("");

    return `<tr style="border-bottom:0.5px solid #eeeeee">
      <td style="padding:12px 12px 12px 0;vertical-align:top">
        <div style="display:flex;align-items:baseline;gap:7px">
          <span style="font-size:10px;font-weight:700;color:#bbb;font-family:monospace;flex-shrink:0">${String.fromCharCode(65 + pi)}</span>
          <span style="font-size:13px;font-weight:700;color:#1a1a1a">${p.name || "Item " + (pi + 1)}</span>
        </div>
        ${p.style ? `<div style="font-size:10px;color:#555;margin-top:2px;padding-left:17px">${p.style}</div>` : ""}
        ${p.color ? `<div style="font-size:10px;color:#888;padding-left:17px">${p.color}</div>` : ""}
      </td>
      <td style="padding:12px 8px;vertical-align:top">
        <div style="display:grid;grid-template-columns:repeat(3,minmax(52px,1fr));gap:3px 6px">
          ${sizeGrid}
        </div>
      </td>
      <td style="padding:12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:600;color:#1a1a1a">${(p.totalQty || 0).toLocaleString()}</td>
      <td style="padding:12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;color:#666">${p.sellPerUnit > 0 ? fmtD(p.sellPerUnit) : "—"}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:700;color:#1a1a1a">${p.grossRev > 0 ? fmtD(p.grossRev) : "—"}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${font}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${font};color:#111;max-width:780px;margin:0 auto">

  <!-- Header -->
  <div style="padding:32px 36px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${data.branding.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${font}">
          ${data.branding.headerAddressHtml}${data.branding.fromEmailQuotes ? `<br/>${data.branding.fromEmailQuotes}` : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">
          ${data.invoiceNum ? "INVOICE #" + data.invoiceNum : "INVOICE"}
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          <div><span style="font-weight:600">Date:</span> ${data.today}</div>
          <div><span style="font-weight:600">Terms:</span> ${data.terms}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Meta strip -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;border-bottom:0.5px solid #e5e7eb;font-family:${font}">
    ${[
      ["Date", data.today],
      ["Terms", data.terms],
      ["Est. ship date", data.shipDate || "TBD"],
      ["Bill to", data.clientName || "—"],
      ...(data.shipToAddress ? [["Ship to", data.shipToAddress]] : []),
    ].map(([k, v], i, arr) =>
      `<div style="padding:8px 12px;${i < arr.length - 1 ? "border-right:0.5px solid #e5e7eb" : ""}">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div>
        <div style="font-size:11px;font-weight:600;color:#1a1a1a">${v}</div>
      </div>`
    ).join("")}
  </div>

  <!-- Items table -->
  <div style="padding:24px 36px">
    <table style="width:100%;border-collapse:collapse;font-family:${font}">
      <thead>
        <tr style="border-bottom:1.5px solid #1a1a1a">
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 0 10px;width:38%">Item</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 0 10px">Sizes</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:right;padding:6px 0 10px;width:60px">Qty</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:right;padding:6px 0 10px;width:80px">Unit price</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:right;padding:6px 0 10px;width:90px">Subtotal</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Total -->
    <div style="display:flex;justify-content:flex-end;padding-top:14px;border-top:1.5px solid #1a1a1a;margin-top:4px">
      <div style="text-align:right">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:2px;font-family:${font}">Subtotal</div>
        <div style="font-size:14px;font-weight:600;letter-spacing:-0.02em;font-family:${font};color:#888;margin-bottom:6px">${fmtD(data.quoteTotal)}</div>
        ${data.taxAmount > 0 ? `
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:2px;font-family:${font}">Sales Tax</div>
        <div style="font-size:14px;font-weight:600;letter-spacing:-0.02em;font-family:${font};color:#888;margin-bottom:6px">${fmtD(data.taxAmount)}</div>
        ` : ""}
        ${data.totalPaid > 0 ? `
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#27500A;margin-bottom:2px;font-family:${font}">Paid</div>
        <div style="font-size:14px;font-weight:600;letter-spacing:-0.02em;font-family:${font};color:#27500A;margin-bottom:6px">-${fmtD(data.totalPaid)}</div>
        ` : ""}
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px;font-family:${font}">Amount due</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em;font-family:${font};color:#1a1a1a">${fmtD(data.balanceDue)}</div>
      </div>
    </div>

    <!-- Notes -->
    ${data.notes ? `
    <div style="margin-top:20px;padding:12px 16px;background:#f9f9f9;border-radius:6px;font-size:11px;color:#555;line-height:1.7;font-family:${font};white-space:pre-line">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Notes</div>
      ${data.notes}
    </div>` : ""}
  </div>

  <!-- Footer -->
  <div style="padding:20px 36px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${font}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${data.branding.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${data.branding.fromEmailQuotes ? `${data.branding.fromEmailQuotes}<br/>` : ""}${data.branding.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa">Thank you for your business.</div>
  </div>

</div>
</body></html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(req: NextRequest, { params }: { params: { jobId: string } }) {
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const portalToken = req.nextUrl.searchParams.get("portal");
  let portalAuth = false;
  if (!internal && portalToken) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: tokenJob } = await sb.from("jobs").select("id").eq("portal_token", portalToken).eq("id", params.jobId).single();
    portalAuth = !!tokenJob;
  }
  if (!internal && !portalAuth) {
    const authClient = await createAuthClient();
    const { data: { user } } = await authClient.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  try {
    const { jobId } = params;
    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*, clients(name)")
      .eq("id", jobId)
      .single();

    if (jobError || !job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const costingData = job.costing_data || {};
    const costProds: any[] = costingData.costProds || [];
    const orderInfo = costingData.orderInfo || {};

    const { data: items } = await supabase
      .from("items")
      .select("id, name, blank_vendor, blank_sku, sell_per_unit, garment_type, ship_qtys, received_qtys, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    const { data: payments } = await supabase
      .from("payment_records")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at");

    const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
    const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });

    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const clientName = (job.clients as any)?.name || "—";
    const termsRaw = job.payment_terms || "";
    const terms = TERMS_LABELS[termsRaw] || termsRaw.replace(/_/g, " ") || "—";

    // items.sell_per_unit is the source of truth — set by CostingTab (auto-calc or override), rounded to cent.
    // After variance push, use shipped/received per-size qtys for the invoice
    // line items so PDF matches what's been billed in QB. Before: use quote qtys.
    const variancePushed = !!(job.type_meta as any)?.qb_variance_pushed_at;
    const prefersReceived = (job as any).shipping_route === "ship_through" || (job as any).shipping_route === "stage";

    let prods: any[] = [];
    if (costProds.length > 0) {
      prods = costProds.map(p => {
        const dbItem = (items || []).find((it: any) => it.id === p.id);
        const quotedQtys = p.qtys || {};

        let effectiveQtys: Record<string, number>;
        if (variancePushed && dbItem) {
          const received = (dbItem.received_qtys || {}) as Record<string, number>;
          const shipped = (dbItem.ship_qtys || {}) as Record<string, number>;
          const firstChoice = prefersReceived ? received : shipped;
          const secondChoice = prefersReceived ? shipped : received;
          effectiveQtys = {};
          for (const sz of Object.keys(quotedQtys)) {
            const a = firstChoice[sz];
            const b = secondChoice[sz];
            effectiveQtys[sz] = a !== undefined ? a : b !== undefined ? b : (quotedQtys[sz] || 0);
          }
        } else {
          effectiveQtys = quotedQtys;
        }

        const totalQty = Object.values(effectiveQtys).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
        if (totalQty === 0) return null;
        const sellPerUnit = parseFloat(dbItem?.sell_per_unit) || 0;
        const grossRev = Math.round(sellPerUnit * totalQty * 100) / 100;
        if (grossRev === 0) return null;
        return {
          name: p.name || dbItem?.name || "Item",
          style: p.style || dbItem?.blank_vendor || "",
          color: p.color || dbItem?.blank_sku || "",
          sizes: sortSizes(Object.keys(effectiveQtys).filter(sz => (effectiveQtys[sz] || 0) > 0)),
          qtys: effectiveQtys,
          totalQty,
          sellPerUnit,
          grossRev,
        };
      }).filter(Boolean);
    }

    const quoteTotal = prods.reduce((a: number, p: any) => a + p.grossRev, 0);
    const taxAmount = job.type_meta?.qb_tax_amount || 0;
    const totalPaid = (payments || []).filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + p.amount, 0);
    const balanceDue = quoteTotal + taxAmount - totalPaid;

    const branding = await getPdfBranding();
    const html = renderInvoiceHTML({
      invoiceNum: job.type_meta?.qb_invoice_number || orderInfo.invoiceNum || job.job_number || "",
      today,
      terms,
      shipDate: job.target_ship_date ? new Date(job.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : "",
      clientName,
      shipToAddress: job.type_meta?.venue_address || (job.clients as any)?.shipping_address || "",
      notes: orderInfo.notes || job.notes || "",
      prods,
      quoteTotal,
      taxAmount,
      totalPaid,
      balanceDue,
      branding,
    });

    // Add PAID stamp if requested
    const paidParam = req.nextUrl.searchParams.get("paid");
    const paidDate = req.nextUrl.searchParams.get("paidDate");
    let finalHtml = html;
    if (paidParam === "true") {
      const stamp = paidDate || new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      finalHtml = html.replace("</body>", `<div style="position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:72px;font-weight:900;color:rgba(26,140,92,0.15);letter-spacing:8px;font-family:system-ui;pointer-events:none;z-index:9999">PAID</div><div style="position:fixed;top:52%;left:50%;transform:translate(-50%,-50%) rotate(-25deg);font-size:18px;font-weight:700;color:rgba(26,140,92,0.25);font-family:system-ui;pointer-events:none;z-index:9999">${stamp}</div></body>`);
    }
    const pdfBuffer = await generatePDF(finalHtml);
    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const displayNum = job.type_meta?.qb_invoice_number || job.job_number || jobId.slice(0, 8);
    const filename = `HPD-Invoice-${displayNum}-${slug}.pdf`;

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
    console.error("[PDF Invoice Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
