import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deriveDateChain } from "@/lib/date-chain";

export const dynamic = "force-dynamic";

// GET /api/item-etas?jobId=… | ?clientId=…
//
// Chain-resolved ETA per item (date model 2026-07-23): derived forward from the
// current actuals — PO ship-by, then the per-item ship/exit-factory edit
// (items.ship_est) in production, then the actual land date (box expected_arrival)
// in receiving, + vendor transit + route buffer. client_eta is retired.
//
// Internal read-only surfaces (job-page items list, client worksheet) call
// this so their chips show the SAME resolved date the Client Hub shows —
// dates are set at the workflow surfaces (PO tab / production2 / receiving2),
// never on the chips. Auth: team cookie session (RLS applies).

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    const clientId = req.nextUrl.searchParams.get("clientId");
    if (!jobId && !clientId) return NextResponse.json({ error: "jobId or clientId required" }, { status: 400 });

    const sb = await createClient();
    let jobsQ = (sb.from("jobs") as any).select("id, shipping_route, type_meta");
    jobsQ = jobId ? jobsQ.eq("id", jobId) : jobsQ.eq("client_id", clientId!);
    const { data: jobs, error: jErr } = await jobsQ;
    if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 });
    const jobById: Record<string, any> = {};
    for (const j of jobs || []) jobById[j.id] = j;
    const jobIds = (jobs || []).map((j: any) => j.id);
    if (!jobIds.length) return NextResponse.json({ etas: {} });

    const { data: items, error: iErr } = await sb
      .from("items")
      .select("id, job_id, shipping_route, ship_est, expected_arrival, decorator_assignments(decorators(name, short_code, lead_time_days, transit_defaults))")
      .in("job_id", jobIds);
    if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    const itemIds = (items || []).map((i: any) => i.id);

    const boxArrivalByItem: Record<string, string> = {};
    if (itemIds.length) {
      const { data: openLines } = await sb
        .from("shipment_lines")
        .select("item_id, received, shipments(expected_arrival)")
        .in("item_id", itemIds).eq("received", false);
      for (const l of openLines || []) {
        const ea = (l as any).shipments?.expected_arrival;
        if (!ea) continue;
        if (!boxArrivalByItem[(l as any).item_id] || ea > boxArrivalByItem[(l as any).item_id]) boxArrivalByItem[(l as any).item_id] = ea;
      }
    }

    const etas: Record<string, { eta: string | null; source: "override" | "derived" | null }> = {};
    for (const it of (items || []) as any[]) {
      const job = jobById[it.job_id] || {};
      const dec = it.decorator_assignments?.[0]?.decorators || null;
      const tm = (job.type_meta || {}) as any;
      const keys = [dec?.name, dec?.short_code].filter(Boolean).map((s: string) => s.toLowerCase().trim());
      const findKey = (map: any): string | null => {
        if (!map) return null;
        for (const k of Object.keys(map)) if (keys.includes(k.toLowerCase().trim())) return k;
        return null;
      };
      const aK = findKey(tm.po_ship_dates), lK = findKey(tm.po_ship_live), mK = findKey(tm.po_ship_methods), sK = findKey(tm.po_sent_dates);
      const chain = deriveDateChain({
        route: (it.shipping_route || job.shipping_route || "ship_through") as any,
        lead: dec?.lead_time_days ?? null,
        transitDefaults: dec?.transit_defaults || null,
        shipMethod: mK ? tm.po_ship_methods[mK] : null,
        poSentDate: sK ? tm.po_sent_dates[sK] : null,
        shipByAgreed: aK ? tm.po_ship_dates[aK] : null,
        shipByLive: lK ? tm.po_ship_live[lK]?.date : null,
        shipByItemOverride: it.ship_est || null,
        // Box-level ETA only — legacy items.expected_arrival retired (fossil dates shadowed the chain).
        arrivalOverride: boxArrivalByItem[it.id] || null,
      });
      etas[it.id] = { eta: chain.clientEta, source: chain.etaSource };
    }
    return NextResponse.json({ etas });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
