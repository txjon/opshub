export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding, type PdfBranding } from "@/lib/branding";

// Pricing source of truth: items.sell_per_unit (set by CostingTab, rounded to cent)

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── HTML renderer ─────────────────────────────────────────────────────────────
function renderQuoteHTML(data: {
  invoiceNum: string; today: string; validUntil: string; shipDate: string;
  clientName: string; notes: string;
  prods: { name: string; style: string; color: string; sizes: string[]; qtys: Record<string,number>; totalQty: number; sellPerUnit: number; grossRev: number; thumbnail?: string; }[];
  quoteTotal: number;
  branding: PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  const itemRows = data.prods.map((p, pi) => {
    const activeSizes = (p.sizes || []).filter(sz => (p.qtys?.[sz] || 0) > 0);
    const sizeGrid = activeSizes.map(sz =>
      `<div style="font-size:10px;color:#444;font-family:monospace;white-space:nowrap"><span style="color:#999;margin-right:3px">${sz}</span>${p.qtys[sz].toLocaleString()}</div>`
    ).join("");

    const thumbHtml = "";

    return `<tr style="border-bottom:0.5px solid #eeeeee">
      <td style="padding:12px 12px 12px 0;vertical-align:top">
        <div style="display:flex;gap:10px;align-items:flex-start">
          ${thumbHtml}
          <div>
            <div style="display:flex;align-items:baseline;gap:7px">
              <span style="font-size:10px;font-weight:700;color:#bbb;font-family:monospace;flex-shrink:0">${String.fromCharCode(65 + pi)}</span>
              <span style="font-size:13px;font-weight:700;color:#1a1a1a">${p.name || "Item " + (pi + 1)}</span>
            </div>
            ${p.style ? `<div style="font-size:10px;color:#555;margin-top:2px;padding-left:17px">${p.style}</div>` : ""}
            ${p.color ? `<div style="font-size:10px;color:#888;padding-left:17px">${p.color}</div>` : ""}
          </div>
        </div>
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
          ${data.branding.headerAddressHtml}<br/>${data.branding.fromEmailQuotes}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;font-family:${font};margin-bottom:8px">
          ${data.invoiceNum ? "QUOTE #" + data.invoiceNum : "QUOTE #—"}
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${font}">
          <div><span style="font-weight:600">Date:</span> ${data.today}</div>
          ${data.validUntil ? `<div><span style="font-weight:600">Valid until:</span> ${data.validUntil}</div>` : ""}
        </div>
      </div>
    </div>
  </div>

  <!-- Meta strip -->
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;border-bottom:0.5px solid #e5e7eb;font-family:${font}">
    ${[
      ["Date", data.today],
      ["Valid until", data.validUntil || "30 days from issue"],
      ["Est. ship date", data.shipDate || "TBD"],
      ["Prepared for", data.clientName || "—"],
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
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px;font-family:${font}">Order total</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em;font-family:${font};color:#1a1a1a">${fmtD(data.quoteTotal)}</div>
        <div style="font-size:9px;color:#999;margin-top:6px;font-family:${font}">Sales tax will be calculated on final invoice</div>
      </div>
    </div>

    <!-- Notes -->
    ${data.notes ? `
    <div style="margin-top:20px;padding:12px 16px;background:#f9f9f9;border-radius:6px;font-size:11px;color:#555;line-height:1.7;font-family:${font};white-space:pre-line">
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">Notes</div>
      ${data.notes}
    </div>` : ""}
  </div>

  <!-- Terms & Conditions -->
  <div style="padding:20px 36px;border-top:0.5px solid #e5e7eb;font-family:${font}">
    <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:8px">Terms & Conditions</div>
    <div style="font-size:8.5px;color:#999;line-height:1.8;columns:2;column-gap:24px">
      <div style="margin-bottom:4px"><strong style="color:#777">Validity:</strong> This quote is valid for 30 days from the date of issue.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Payment:</strong> Payment terms as agreed. A deposit may be required before production begins.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Production:</strong> Lead times begin after approval of quote, receipt of payment, and approval of all artwork/proofs.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Art &amp; Proofs:</strong> Client is responsible for reviewing and approving all proofs prior to production. Changes after approval may incur additional charges.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Quantities:</strong> Final quantities may vary +/- 3% from the order due to standard production tolerances.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Shipping:</strong> Shipping costs are estimated and may vary. Final shipping charges will appear on the invoice.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Sales Tax:</strong> Applicable sales tax will be calculated and added to the final invoice.</div>
      <div><strong style="color:#777">Cancellation:</strong> Orders cancelled after production begins may be subject to cancellation fees.</div>
    </div>
  </div>

</div>
</body></html>`;
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function GET(_req: NextRequest, { params }: { params: { jobId: string } }) {
  // Auth check — logged-in users, internal calls, or portal token
  const internal = _req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const portalToken = _req.nextUrl.searchParams.get("portal");
  let portalAuth = false;
  if (portalToken && !internal) {
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: pj } = await sb.from("jobs").select("id").eq("portal_token", portalToken).eq("id", params.jobId).single();
    portalAuth = !!pj;
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

    if (jobError || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    const costingData = job.costing_data || {};
    const costProds: any[] = costingData.costProds || [];
    const orderInfo = costingData.orderInfo || {};

    // Fetch buy_sheet_lines for accurate qtys
    const { data: items } = await supabase
      .from("items")
      .select("id, name, blank_vendor, blank_sku, sell_per_unit, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    // Build size/qty maps from DB
    const itemQtys: Record<string, Record<string, number>> = {};
    for (const it of (items || [])) {
      const qtys: Record<string, number> = {};
      for (const l of (it.buy_sheet_lines || [])) {
        qtys[l.size] = l.qty_ordered || 0;
      }
      itemQtys[it.id] = qtys;
    }

    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const clientName = (job.clients as any)?.name || orderInfo.clientName || "—";

    // Build product list — use costing_data if available, fall back to items table
    let prods: any[] = [];

    const SIZE_ORDER = ["OSFA","OS","XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL","YXS","YS","YM","YL","YXL"];
    const sortSizes = (sizes: string[]) => [...sizes].sort((a, b) => {
      const ai = SIZE_ORDER.indexOf(a), bi = SIZE_ORDER.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1; if (bi === -1) return -1;
      return ai - bi;
    });

    // items.sell_per_unit is the source of truth — set by CostingTab (auto-calc or override), rounded to cent
    if (costProds.length > 0) {
      prods = costProds
        .map(p => {
          const savedQtys = p.qtys || {};
          const totalQty = p.totalQty || Object.values(savedQtys).reduce((a: number, v: any) => a + v, 0);
          if (totalQty === 0) return null;

          const dbItem = (items || []).find((it: any) => it.id === p.id);
          const sellPerUnit = parseFloat(dbItem?.sell_per_unit) || 0;
          const grossRev = Math.round(sellPerUnit * totalQty * 100) / 100;
          if (grossRev === 0) return null;

          return {
            name: p.name || dbItem?.name || "Item",
            style: p.style || dbItem?.blank_vendor || "",
            color: p.color || dbItem?.blank_sku || "",
            sizes: sortSizes(Object.keys(savedQtys).filter(sz => (savedQtys[sz] || 0) > 0)),
            qtys: savedQtys,
            totalQty,
            sellPerUnit,
            grossRev,
          };
        })
        .filter(Boolean);
    } else {
      // Fallback: use items table with sell_per_unit
      const { data: fullItems } = await supabase
        .from("items")
        .select("*, buy_sheet_lines(size, qty_ordered)")
        .eq("job_id", jobId)
        .order("sort_order");

      prods = (fullItems || []).map((it: any) => {
        const qtys: Record<string, number> = {};
        for (const l of (it.buy_sheet_lines || [])) { qtys[l.size] = l.qty_ordered || 0; }
        const totalQty = Object.values(qtys).reduce((a, v) => a + v, 0);
        const sellPerUnit = parseFloat(it.sell_per_unit) || 0;
        return {
          name: it.name,
          style: it.blank_vendor || "",
          color: it.blank_sku || "",
          sizes: Object.keys(qtys),
          qtys,
          totalQty,
          sellPerUnit,
          grossRev: sellPerUnit * totalQty,
        };
      }).filter((p: any) => p.totalQty > 0);
    }

    // Round each line item's grossRev to 2 decimals before summing — total matches what client sees
    const quoteTotal = prods.reduce((a, p) => a + p.grossRev, 0);

    const branding = await getPdfBranding();
    const html = renderQuoteHTML({
      invoiceNum: orderInfo.invoiceNum || job.job_number || "",
      today,
      validUntil: orderInfo.validUntil || "",
      shipDate: orderInfo.shipDate || job.target_ship_date || "",
      clientName,
      notes: orderInfo.notes || job.notes || "",
      prods,
      quoteTotal,
      branding,
    });

    const pdfBuffer = await generatePDF(html);
    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const qNum = orderInfo.invoiceNum || job.job_number || jobId.slice(0, 8);
    const filename = `HPD-Quote-${qNum}-${slug}.pdf`;
    const isDownload = _req.nextUrl.searchParams.get("download");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${isDownload ? "attachment" : "inline"}; filename="${filename}"`,
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF Quote Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
