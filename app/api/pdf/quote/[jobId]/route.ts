export const runtime = "nodejs";
export const maxDuration = 60;
export const preferredRegion = "iad1";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { getPdfBranding, type PdfBranding } from "@/lib/branding";
import { parseSizeMatrix, sizeMatrixHtml } from "@/lib/size-grid";
import { contentDisposition } from "@/lib/pdf/filename";

// Pricing source of truth: items.sell_per_unit (set by CostingTab, rounded to cent)

const fmtD = (n: number) => "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── HTML renderer ─────────────────────────────────────────────────────────────
function renderQuoteHTML(data: {
  invoiceNum: string; today: string; validUntil: string; shipDate: string;
  clientName: string; notes: string;
  prods: { name: string; style: string; color: string; sizes: string[]; qtys: Record<string,number>; totalQty: number; sellPerUnit: number; grossRev: number; free?: boolean; thumbnail?: string; }[];
  extraLines: { description: string; amount: number }[];
  quoteTotal: number;
  branding: PdfBranding;
}): string {
  const font = `'Helvetica Neue', Arial, sans-serif`;

  const itemRows = data.prods.map((p, pi) => {
    const activeSizes = (p.sizes || []).filter(sz => (p.qtys?.[sz] || 0) > 0);
    const dimM = parseSizeMatrix(activeSizes, p.qtys);

    const nameCell = `<td style="padding:12px 12px 12px 0;vertical-align:top">
        <div>
          <div style="display:flex;align-items:baseline;gap:7px">
            <span style="font-size:10px;font-weight:700;color:#bbb;font-family:monospace;flex-shrink:0">${String.fromCharCode(65 + pi)}</span>
            <span style="font-size:13px;font-weight:700;color:#1a1a1a">${p.name || "Item " + (pi + 1)}</span>
          </div>
          ${p.style ? `<div style="font-size:10px;color:#555;margin-top:2px;padding-left:17px">${p.style}</div>` : ""}
          ${p.color ? `<div style="font-size:10px;color:#888;padding-left:17px">${p.color}</div>` : ""}
        </div>
      </td>`;
    const qtyCell = `<td style="padding:12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:600;color:#1a1a1a">${(p.totalQty || 0).toLocaleString()}</td>`;
    const unitCell = `<td style="padding:12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;color:#666">${p.sellPerUnit > 0 ? fmtD(p.sellPerUnit) : (p.free ? "$0.00" : "—")}</td>`;
    const subCell = `<td style="padding:12px 0 12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:700;color:#1a1a1a">${p.grossRev > 0 ? fmtD(p.grossRev) : (p.free ? "$0.00" : "—")}</td>`;

    // Dimensional pants → compact "fits · N sizes" in the Sizes column, then a
    // full-width cut-ticket grid block below the line (client picked full grid).
    if (dimM) {
      const fits = dimM.groups.map(g => g.name).filter(Boolean).join(", ");
      const summary = [fits, `${activeSizes.length} sizes`].filter(Boolean).join(" · ");
      const gridHtml = sizeMatrixHtml(activeSizes, p.qtys, { mono: "monospace" });
      return `<tr>
      ${nameCell}
      <td style="padding:12px 8px;vertical-align:top"><span style="font-size:10px;color:#666;font-family:monospace">${summary}</span></td>
      ${qtyCell}${unitCell}${subCell}
    </tr>
    <tr style="border-bottom:0.5px solid #eeeeee"><td colspan="5" style="padding:0 8px 14px 0">${gridHtml}</td></tr>`;
    }

    const sizeGrid = activeSizes.map(sz =>
      `<div style="font-size:10px;color:#444;font-family:monospace;white-space:nowrap"><span style="color:#999;margin-right:3px">${sz}</span>${p.qtys[sz].toLocaleString()}</div>`
    ).join("");
    return `<tr style="border-bottom:0.5px solid #eeeeee">
      ${nameCell}
      <td style="padding:12px 8px;vertical-align:top">
        <div style="display:grid;grid-template-columns:repeat(3,minmax(52px,1fr));gap:3px 6px">
          ${sizeGrid}
        </div>
      </td>
      ${qtyCell}${unitCell}${subCell}
    </tr>`;
  }).join("");

  // Non-item lines (service fees, passthru charges, discounts) from
  // jobs.type_meta.invoice_extra_lines — same rows the invoice PDF renders, so
  // the quote the client approves matches the invoice they're billed. Span the
  // Item → Unit columns; amount sits in the Subtotal column.
  const extraRows = (data.extraLines || []).map(l => `<tr style="border-bottom:0.5px solid #eeeeee">
      <td colspan="4" style="padding:12px 12px 12px 0;vertical-align:top">
        <div style="font-size:13px;font-weight:700;color:#1a1a1a">${l.description || "Additional charge"}</div>
      </td>
      <td style="padding:12px 0 12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:700;color:#1a1a1a">${fmtD(l.amount)}</td>
    </tr>`).join("");

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
      <tbody>${itemRows}${extraRows}</tbody>
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
      ${data.branding.slug === "dmd" ? `
      <div style="margin-bottom:4px"><strong style="color:#777">Validity:</strong> This quote is valid for 30 days from the date of issue.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Payment &amp; Deposit:</strong> Payment terms as agreed. A deposit is required before production begins; the balance is due prior to shipment unless otherwise agreed in writing.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Pre-Production &amp; Approval:</strong> Tech packs, patterns, and pre-production samples must be approved in writing before bulk production. Changes after approval may affect price and lead time.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Materials:</strong> Fabric, trim, and component availability can affect lead time, color, and pricing. Equivalent materials may be substituted when a specified material is unavailable.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Production Lead Time:</strong> Lead times begin after the approved sample/quote, receipt of payment, and final approval of all specifications and artwork.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Measurements &amp; Fit:</strong> Garments are produced to the approved spec and grade. Standard cut-and-sew tolerances apply (typically +/- 1/2&quot; on key measurements).</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Color &amp; Dye Lots:</strong> Slight variation in color, dye lots, wash, and hand across production runs is inherent to apparel manufacturing and is not grounds for rejection.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Quantities:</strong> Final quantities may vary +/- 3% per standard production tolerances and are billed at the quantity produced.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Shipping &amp; Duties:</strong> Shipping, freight, and any applicable import duties are estimated and may vary. Final charges appear on the invoice.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Sales Tax:</strong> Applicable sales tax will be calculated and added to the final invoice.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Cancellation:</strong> Orders cancelled after materials are sourced or production begins may be subject to fees for work and materials incurred.</div>
      <div><strong style="color:#777">Artwork &amp; IP:</strong> Client warrants it holds all rights to the designs, trademarks, and artwork provided for production.</div>
      ` : `
      <div style="margin-bottom:4px"><strong style="color:#777">Validity:</strong> This quote is valid for 30 days from the date of issue.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Payment:</strong> Payment terms as agreed. A deposit may be required before production begins.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Production:</strong> Lead times begin after approval of quote, receipt of payment, and approval of all artwork/proofs.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Art &amp; Proofs:</strong> Client is responsible for reviewing and approving all proofs prior to production. Changes after approval may incur additional charges.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Quantities:</strong> Final quantities may vary +/- 3% from the order due to standard production tolerances.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Shipping:</strong> Shipping costs are estimated and may vary. Final shipping charges will appear on the invoice.</div>
      <div style="margin-bottom:4px"><strong style="color:#777">Sales Tax:</strong> Applicable sales tax will be calculated and added to the final invoice.</div>
      <div><strong style="color:#777">Cancellation:</strong> Orders cancelled after production begins may be subject to cancellation fees.</div>
      `}
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
      .select("id, name, blank_vendor, blank_sku, sell_per_unit, client_eta, buy_sheet_lines(size, qty_ordered)")
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

    // Quote date — pin to the date the quote was originally sent so
    // a client re-opening their portal a month later still sees the
    // correct issue date on the PDF. Falls back to today only when
    // the quote hasn't been sent yet (HPD-side preview / draft view).
    const quoteSentAt = (job.type_meta as any)?.quote_sent_at;
    const today = (quoteSentAt ? new Date(quoteSentAt) : new Date())
      // Vercel renders in UTC — pin to Vegas so an evening send doesn't print tomorrow's date
      .toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "America/Los_Angeles" });
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
          // A $0 line shows ONLY when the price was deliberately set to $0
          // (sellOverride === 0) — a real "no charge" deliverable that belongs
          // on the record. A $0 from an un-costed item (no override) stays
          // hidden so unpriced lines don't leak onto the quote.
          const deliberateFree = p.sellOverride != null && p.sellOverride !== "" && Number(p.sellOverride) === 0;
          if (grossRev === 0 && !deliberateFree) return null;

          return {
            name: p.name || dbItem?.name || "Item",
            style: p.style || dbItem?.blank_vendor || "",
            color: p.color || dbItem?.blank_sku || "",
            sizes: sortSizes(Object.keys(savedQtys).filter(sz => (savedQtys[sz] || 0) > 0)),
            qtys: savedQtys,
            totalQty,
            sellPerUnit,
            grossRev,
            free: deliberateFree,
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

    // Custom invoice lines (Additional charges) — same source as the invoice
    // PDF (jobs.type_meta.invoice_extra_lines), folded into the quote total so
    // the quote the client approves matches the invoice they're billed.
    const extraLines = (Array.isArray(job.type_meta?.invoice_extra_lines) ? job.type_meta.invoice_extra_lines : [])
      .map((l: any) => ({ description: String(l?.description || "Additional charge"), amount: Number(l?.amount) || 0 }));
    const extraTotal = extraLines.reduce((a: number, l: any) => a + l.amount, 0);
    // Round each line item's grossRev to 2 decimals before summing — total matches what client sees
    const quoteTotal = prods.reduce((a, p) => a + p.grossRev, 0) + extraTotal;

    // D4 (locked 2026-07-15): the quote's Est-ship line exists ONLY when the
    // requested in-hands date was deliberately set — and it shows that date.
    // In-hands blank (the normal case: standard turnaround, case-by-case
    // approvals) = no line. The old latest-client_eta fallback printed a date
    // nobody promised.
    const shipDateLong = job.target_ship_date
      ? new Date(job.target_ship_date + "T12:00:00").toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : "";

    const branding = await getPdfBranding();
    const html = renderQuoteHTML({
      invoiceNum: orderInfo.invoiceNum || job.job_number || "",
      today,
      validUntil: orderInfo.validUntil || "",
      shipDate: shipDateLong,
      clientName,
      notes: orderInfo.notes || job.notes || "",
      prods,
      extraLines,
      quoteTotal,
      branding,
    });

    const pdfBuffer = await generatePDF(html);
    const slug = (job.title || jobId).replace(/\s+/g, "-");
    const qNum = orderInfo.invoiceNum || job.job_number || jobId.slice(0, 8);
    const rawName = `HPD-Quote-${qNum}-${slug}.pdf`;
    const isDownload = _req.nextUrl.searchParams.get("download");

    return new NextResponse(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": contentDisposition(rawName, isDownload),
        "Content-Length": pdfBuffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[PDF Quote Error]", err);
    return NextResponse.json({ error: "PDF generation failed", detail: err.message }, { status: 500 });
  }
}
