export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createAuthClient } from "@/lib/supabase/server";
import { generatePostageXlsx, PostageLine, PostageTotals } from "@/lib/shipstation-xlsx";

// Shipment-level xlsx export that accompanies the Fulfillment Invoice
// PDF. Same auth model as /api/pdf/shipstation/[id]:
//   1. internal key for server-to-server (email route fetches this)
//   2. client-hub portal token (?portal=TOKEN) scoped to the report's client
//   3. otherwise a logged-in OpsHub session
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
  const portalToken = req.nextUrl.searchParams.get("portal");

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

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

    const isCombined = report.report_type === "combined";
    if (report.report_type !== "postage" && !isCombined) {
      return NextResponse.json({ error: "Excel export is only available for postage and Full Service reports" }, { status: 400 });
    }

    const clientName = (report.clients as any)?.name || "—";
    const generatedOn = new Date(report.created_at).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });

    // Combined reports keep the postage half on dedicated columns.
    // Postage-only reports keep it on line_items / totals.
    const lines = (isCombined
      ? (report as any).postage_line_items
      : report.line_items) || [];
    const totals = (isCombined
      ? (report as any).postage_totals
      : report.totals) || { shipments: 0, items: 0, paid: 0, cost_raw: 0, cost: 0, insurance: 0, billed: 0, margin: 0 };

    const buffer = await generatePostageXlsx({
      clientName,
      periodLabel: report.period_label,
      invoiceNumber: report.qb_invoice_number || null,
      generatedOn,
      perPackageFee: Number((report as any).per_package_fee) || 0,
      lines: lines as PostageLine[],
      totals: totals as PostageTotals,
    });

    const slug = (clientName + "-" + report.period_label).replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    const filename = `HPD-${isCombined ? "Full-Service-Shipments" : "Fulfillment-Shipments"}-${slug}.xlsx`;

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": buffer.byteLength.toString(),
      },
    });
  } catch (err: any) {
    console.error("[Excel ShipStation Report Error]", err);
    return NextResponse.json({ error: "Excel generation failed", detail: err.message }, { status: 500 });
  }
}
