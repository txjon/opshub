export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";
import { sortSizes } from "@/lib/theme";
import { deductSamples } from "@/lib/qty";
import { getPdfBranding } from "@/lib/branding";

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
    const { data: job } = await supabase.from("jobs").select("*, clients(name)").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { data: items } = await supabase
      .from("items")
      .select("*, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id, decorators(name))")
      .eq("job_id", jobId)
      .order("sort_order");

    const clientName = (job.clients as any)?.name || "Client";
    const jobNumber = job.job_number || "";
    const invoiceNum = (job.type_meta as any)?.qb_invoice_number || jobNumber;
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const route = job.shipping_route || "ship_through";
    const isDropShip = route === "drop_ship";

    // Optional filters — limit the slip to one decorator and/or one tracking number
    const decoratorFilter = req.nextUrl.searchParams.get("decoratorId");
    const trackingFilter = req.nextUrl.searchParams.get("tracking");
    let vendorScopedItems = decoratorFilter
      ? (items || []).filter((it: any) => (it.decorator_assignments || []).some((da: any) => da.decorator_id === decoratorFilter))
      : (items || []);
    if (trackingFilter) {
      vendorScopedItems = vendorScopedItems.filter((it: any) => (it.ship_tracking || "") === trackingFilter);
    }
    const vendorName = decoratorFilter
      ? (vendorScopedItems[0]?.decorator_assignments?.[0]?.decorators?.name || "")
      : "";

    // Color comes from costing_data (cp.color), not the items table.
    // Match by id first, fall back by name (covers items rebuilt via
    // ProductBuilder where cp.id may not equal item.id).
    const costProds = ((job.costing_data as any)?.costProds || []) as any[];
    const colorByItemId: Record<string, string> = {};
    const colorByItemName: Record<string, string> = {};
    for (const cp of costProds) {
      if (cp?.id && cp?.color) colorByItemId[cp.id] = cp.color;
      if (cp?.name && cp?.color) colorByItemName[cp.name] = cp.color;
    }

    const itemRows = vendorScopedItems.filter((it: any) => it.pipeline_stage === "shipped" || it.received_at_hpd || it.ship_tracking).map((item: any, i: number) => {
      const lines = item.buy_sheet_lines || [];
      const itemColor = colorByItemId[item.id] || colorByItemName[item.name] || "";
      // Priority: best available qty source. Drop-ship prefers decorator-reported
      // ship_qtys; ship-through/stage prefers HPD-confirmed received_qtys. Either
      // way, fall through to the other source if primary is empty, then to ordered.
      const received = (item.received_qtys || {}) as Record<string, number>;
      const shipped = (item.ship_qtys || {}) as Record<string, number>;
      const firstChoice = isDropShip ? shipped : received;
      const secondChoice = isDropShip ? received : shipped;
      const orderedQtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
      const deliveredQtys: Record<string, number> = {};
      for (const l of lines) {
        const fromFirst = firstChoice[l.size];
        const fromSecond = secondChoice[l.size];
        deliveredQtys[l.size] = (fromFirst !== undefined ? fromFirst : (fromSecond !== undefined ? fromSecond : orderedQtys[l.size])) ?? 0;
      }
      // Continuing = delivered − samples pulled at HPD. Drop-ship items don't
      // have samples (sample_qtys is empty) so this is a no-op for them.
      const finalQtys = deductSamples(deliveredQtys, item.sample_qtys);
      const totalQty = Object.values(finalQtys).reduce((a, v) => a + v, 0);
      // Drop ship: decorator tracking. Ship-through/stage: HPD outbound tracking.
      const tracking = isDropShip ? (item.ship_tracking || "\u2014") : (job.fulfillment_tracking || "\u2014");

      // Sort sizes via the canonical theme order (XS, S, M, L, XL, 2XL, …)
      // so the slip reads left-to-right in natural order.
      const sortedSizeKeys = sortSizes(Object.keys(finalQtys).filter(sz => (finalQtys[sz] || 0) > 0));
      const sizeGrid = sortedSizeKeys.map(sz =>
        `<div style="font-size:10px;color:#444;font-family:monospace;white-space:nowrap"><span style="color:#999;margin-right:3px">${sz}</span>${finalQtys[sz].toLocaleString()}</div>`
      ).join("");

      // Build the specs sub-line: vendor · sku · color (whichever are set).
      // Case-insensitive dedupe — many items store the color name in
      // blank_sku, which would otherwise render as "Vendor · Black · Black".
      const seenSpec = new Set<string>();
      const specParts: string[] = [];
      for (const part of [item.blank_vendor, item.blank_sku, itemColor]) {
        const trimmed = (part || "").toString().trim();
        if (!trimmed) continue;
        const key = trimmed.toLowerCase();
        if (seenSpec.has(key)) continue;
        seenSpec.add(key);
        specParts.push(trimmed);
      }
      const specsLine = specParts.length > 0
        ? `<div style="font-size:10px;color:#666;margin-top:2px;padding-left:17px">${specParts.join(" · ")}</div>`
        : "";

      return `<tr style="border-bottom:0.5px solid #eeeeee">
        <td style="padding:12px 12px 12px 12px;vertical-align:top">
          <div style="display:flex;align-items:baseline;gap:7px">
            <span style="font-size:10px;font-weight:700;color:#bbb;font-family:monospace;flex-shrink:0">${String.fromCharCode(65 + i)}</span>
            <span style="font-size:13px;font-weight:700;color:#1a1a1a">${item.name || "Item " + (i + 1)}</span>
          </div>
          ${specsLine}
        </td>
        <td style="padding:12px 8px;vertical-align:top">
          <div style="display:flex;flex-wrap:nowrap;gap:10px;white-space:nowrap">
            ${sizeGrid}
          </div>
        </td>
        <td style="padding:12px 8px;text-align:right;font-family:monospace;font-size:12px;vertical-align:top;font-weight:600;color:#1a1a1a">${totalQty.toLocaleString()}</td>
        <td style="padding:12px 12px 12px 8px;vertical-align:top;font-family:monospace;font-size:11px;color:#666">${tracking}</td>
      </tr>`;
    }).join("");

    const totalUnits = vendorScopedItems.filter((it: any) => it.pipeline_stage === "shipped" || it.received_at_hpd || it.ship_tracking)
      .reduce((a: number, it: any) => {
        const lines = it.buy_sheet_lines || [];
        const received = (it.received_qtys || {}) as Record<string, number>;
        const shipped = (it.ship_qtys || {}) as Record<string, number>;
        const firstChoice = isDropShip ? shipped : received;
        const secondChoice = isDropShip ? received : shipped;
        const delivered: Record<string, number> = {};
        for (const l of lines) {
          delivered[l.size] = firstChoice[l.size] !== undefined ? firstChoice[l.size] : (secondChoice[l.size] !== undefined ? secondChoice[l.size] : (l.qty_ordered || 0));
        }
        const continuing = deductSamples(delivered, it.sample_qtys);
        return a + Object.values(continuing).reduce((b: number, v) => b + (v || 0), 0);
      }, 0);

    const shipTo = (job.type_meta as any)?.venue_address || (job.type_meta as any)?.po_ship_to?.default || "";

    const fnt = `'Helvetica Neue', Arial, sans-serif`;
    const shipDate = job.target_ship_date || (job.type_meta as any)?.ship_date || "";
    const branding = await getPdfBranding();

    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: ${fnt}; font-size: 11px; color: #1a1a1a; background: white; }
  @media print { body { -webkit-print-color-adjust: exact; } }
</style>
</head><body>
<div style="background:#fff;font-family:${fnt};color:#111;max-width:780px;margin:0 auto">

  <!-- Header -->
  <div style="padding:32px 36px 24px;border-bottom:3px solid #111">
    <div style="display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        ${branding.logoSvg}
        <div style="font-size:11px;color:#666;line-height:1.7;font-family:${fnt}">
          ${branding.headerAddressHtml}${branding.fromEmailQuotes ? "<br/>" + branding.fromEmailQuotes : ""}
        </div>
      </div>
      <div style="text-align:right">
        <div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;font-family:${fnt};margin-bottom:8px">
          PACKING SLIP
        </div>
        <div style="font-size:11px;color:#666;line-height:1.8;font-family:${fnt}">
          <div><span style="font-weight:600">Date:</span> ${today}</div>
          <div><span style="font-weight:600">Order:</span> ${invoiceNum}</div>
        </div>
      </div>
    </div>
  </div>

  <!-- Meta strip -->
  <div style="display:grid;grid-template-columns:${shipDate ? "1fr 1fr 1fr 1fr" : "1fr 1fr 1fr"};border-bottom:0.5px solid #e5e7eb;font-family:${fnt}">
    ${[
      ["Ship to", clientName || "\u2014"],
      ["Project", job.title || "\u2014"],
      ...(shipTo ? [["Address", shipTo]] : []),
      ...(shipDate ? [["Ship date", shipDate]] : []),
    ].map(([k, v]: any, i: number, arr: any[]) =>
      `<div style="padding:8px 12px;${i < arr.length - 1 ? "border-right:0.5px solid #e5e7eb" : ""}">
        <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:2px">${k}</div>
        <div style="font-size:11px;font-weight:600;color:#1a1a1a;white-space:pre-wrap">${v}</div>
      </div>`
    ).join("")}
  </div>

  <!-- Items table — full container width, matches meta strip above.
       Cell padding handles inner spacing instead of section padding. -->
  <div style="padding:24px 0">
    <table style="width:100%;border-collapse:collapse;font-family:${fnt}">
      <thead>
        <tr style="border-bottom:1.5px solid #1a1a1a">
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 8px 10px 12px;width:32%">Item</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 8px 10px;">Sizes</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:right;padding:6px 8px 10px;width:60px">Qty</th>
          <th style="font-size:9px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:0.1em;text-align:left;padding:6px 12px 10px 8px;width:160px">Tracking</th>
        </tr>
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <!-- Total -->
    <div style="display:flex;justify-content:flex-end;padding:14px 12px 0;border-top:1.5px solid #1a1a1a;margin-top:4px">
      <div style="text-align:right">
        <div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.12em;color:#aaa;margin-bottom:4px;font-family:${fnt}">Total units</div>
        <div style="font-size:26px;font-weight:800;letter-spacing:-0.03em;font-family:${fnt};color:#1a1a1a">${totalUnits.toLocaleString()}</div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="padding:20px 36px;border-top:0.5px solid #e5e7eb;display:flex;justify-content:space-between;align-items:flex-end;font-family:${fnt}">
    <div>
      <div style="font-size:8px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#aaa;margin-bottom:6px">${branding.name}</div>
      <div style="font-size:10px;color:#666;line-height:1.8">${branding.fromEmailQuotes ? branding.fromEmailQuotes + "<br/>" : ""}${branding.headerAddressHtml}</div>
    </div>
    <div style="font-size:9px;color:#aaa">Thank you for your business.</div>
  </div>

</div>
</body></html>`;

    const pdfBuffer = await generatePDF(html);
    const filename = `HPD-PackingSlip-${invoiceNum}.pdf`;

    return new NextResponse(pdfBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
