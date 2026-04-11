export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePDF } from "@/lib/pdf/browser";

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
      .select("*, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    const clientName = (job.clients as any)?.name || "Client";
    const jobNumber = job.job_number || "";
    const invoiceNum = (job.type_meta as any)?.qb_invoice_number || jobNumber;
    const today = new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    const route = job.shipping_route || "ship_through";
    const isDropShip = route === "drop_ship";

    const itemRows = (items || []).filter((it: any) => it.pipeline_stage === "shipped" || it.received_at_hpd || it.ship_tracking).map((item: any, i: number) => {
      const lines = item.buy_sheet_lines || [];
      // Drop ship: use ship_qtys (what decorator shipped). Ship-through/stage: use received_qtys (what HPD confirmed).
      const qtySource = isDropShip ? (item.ship_qtys || {}) : (item.received_qtys || {});
      const orderedQtys = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
      // Use route-appropriate qtys, fall back to ordered
      const finalQtys: Record<string, number> = {};
      for (const l of lines) {
        finalQtys[l.size] = qtySource[l.size] ?? orderedQtys[l.size] ?? 0;
      }
      const sizeQtys = Object.entries(finalQtys).filter(([, q]) => q > 0).map(([sz, q]) => `${sz}: ${q}`).join(", ");
      const totalQty = Object.values(finalQtys).reduce((a, v) => a + v, 0);
      // Drop ship: decorator tracking. Ship-through/stage: HPD outbound tracking.
      const tracking = isDropShip ? (item.ship_tracking || "—") : (job.fulfillment_tracking || "—");
      return `<tr style="border-bottom:1px solid #e0e0e4">
        <td style="padding:10px 8px;font-weight:600">${String.fromCharCode(65 + i)}</td>
        <td style="padding:10px 8px;font-weight:600">${item.name || "Item"}</td>
        <td style="padding:10px 8px;color:#6b6b78;font-size:11px">${item.blank_vendor || ""}${item.color ? " · " + item.color : ""}</td>
        <td style="padding:10px 8px;font-family:monospace;font-size:11px">${sizeQtys}</td>
        <td style="padding:10px 8px;font-weight:700;text-align:right">${totalQty}</td>
        <td style="padding:10px 8px;font-family:monospace;font-size:11px">${tracking}</td>
      </tr>`;
    }).join("");

    const totalUnits = (items || []).filter((it: any) => it.pipeline_stage === "shipped" || it.received_at_hpd || it.ship_tracking)
      .reduce((a: number, it: any) => {
        const lines = it.buy_sheet_lines || [];
        const qtySource = isDropShip ? (it.ship_qtys || {}) : (it.received_qtys || {});
        return a + lines.reduce((b: number, l: any) => b + (qtySource[l.size] ?? l.qty_ordered ?? 0), 0);
      }, 0);

    const shipTo = (job.type_meta as any)?.venue_address || (job.type_meta as any)?.po_ship_to?.default || "";

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body { font-family: Inter, -apple-system, sans-serif; color: #1a1a1a; margin: 0; padding: 40px; }
      table { width: 100%; border-collapse: collapse; font-size: 13px; }
      th { text-align: left; padding: 8px; font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6b78; border-bottom: 2px solid #1a1a1a; }
    </style></head><body>
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:30px">
        <div>
          <div style="font-size:24px;font-weight:900;letter-spacing:-0.02em">house party distro</div>
          <div style="font-size:11px;color:#6b6b78;margin-top:4px">4670 W Silverado Ranch Blvd, STE 120<br>Las Vegas, NV 89139</div>
        </div>
        <div style="text-align:right">
          <div style="font-size:18px;font-weight:800">PACKING SLIP</div>
          <div style="font-size:11px;color:#6b6b78;margin-top:4px">Date: ${today}</div>
          <div style="font-size:11px;color:#6b6b78">Order: ${invoiceNum}</div>
        </div>
      </div>
      <div style="display:flex;gap:40px;margin-bottom:24px;padding:12px 16px;background:#f3f3f5;border-radius:6px">
        <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b78;margin-bottom:4px">Ship To</div><div style="font-size:12px;white-space:pre-wrap">${clientName}${shipTo ? "\n" + shipTo : ""}</div></div>
        <div><div style="font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#6b6b78;margin-bottom:4px">Project</div><div style="font-size:12px">${job.title || ""}</div></div>
      </div>
      <table>
        <thead><tr><th></th><th>Item</th><th>Style</th><th>Sizes</th><th style="text-align:right">Qty</th><th>Tracking</th></tr></thead>
        <tbody>${itemRows}</tbody>
        <tfoot><tr style="border-top:2px solid #1a1a1a"><td colspan="4" style="padding:10px 8px;font-weight:700">Total</td><td style="padding:10px 8px;font-weight:700;text-align:right">${totalUnits}</td><td></td></tr></tfoot>
      </table>
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
