import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resolveItemStatus } from "@/lib/item-status";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/portal/client/[token]/items
//
// Returns every item for the client that owns this portal token, pooled
// across every job. Used by:
//   1. The Items tab — client-facing catalog with search + status filter
//   2. The Staging release planner — the left-side item pool that gets
//      dragged into release buckets
//
// Status comes from the canonical lib/item-status resolver so the
// portal matches the internal Worksheet, Project Overview, Production
// page, etc. — one source of truth, one vocabulary on every surface.

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();

    // 1. Resolve client from token.
    const { data: client } = await db
      .from("clients")
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    // 2. Fetch every job for this client (we include cancelled here — the
    //    UI can filter. A "paid to archive" toggle can hide them client-side.)
    const { data: jobs } = await db
      .from("jobs")
      .select("id, job_number, title, phase, target_ship_date, created_at, shipping_route, phase_timestamps")
      .eq("client_id", client.id)
      .order("created_at", { ascending: false });
    const jobById: Record<string, any> = {};
    for (const j of (jobs || [])) jobById[j.id] = j;
    const jobIds = (jobs || []).map((j: any) => j.id);
    if (jobIds.length === 0) {
      return NextResponse.json({ client: { name: client.name }, items: [] });
    }

    // 3. Fetch every item on those jobs.
    const { data: items } = await db
      .from("items")
      .select("id, job_id, name, garment_type, mockup_color, pipeline_stage, received_at_hpd, blanks_order_cost, sell_per_unit, design_id, created_at, sort_order, client_eta, client_eta_note, archived_at")
      .in("job_id", jobIds)
      .order("created_at", { ascending: false });
    const itemIds = (items || []).map((i: any) => i.id);

    // 4. Buy sheet lines for qty roll-up per item.
    const { data: bsLines } = await db
      .from("buy_sheet_lines")
      .select("item_id, qty_ordered")
      .in("item_id", itemIds);
    const qtyByItem: Record<string, number> = {};
    for (const l of (bsLines || [])) {
      qtyByItem[l.item_id] = (qtyByItem[l.item_id] || 0) + (Number(l.qty_ordered) || 0);
    }

    // 5. Thumbnails — prefer mockup > proof > print_ready (matches Orders tab).
    const thumbByItem: Record<string, string | null> = {};
    if (itemIds.length > 0) {
      const { data: files } = await db
        .from("item_files")
        .select("item_id, stage, drive_file_id, created_at")
        .in("item_id", itemIds)
        .in("stage", ["mockup", "proof", "print_ready"])
        .is("superseded_at", null)
        .not("drive_file_id", "is", null)
        .order("created_at", { ascending: false });
      const rank: Record<string, number> = { mockup: 3, proof: 2, print_ready: 1 };
      const bestRank: Record<string, number> = {};
      for (const f of (files || [])) {
        const r = rank[f.stage] || 0;
        if (r > (bestRank[f.item_id] || 0)) {
          bestRank[f.item_id] = r;
          thumbByItem[f.item_id] = f.drive_file_id;
        }
      }
    }

    // 6. Related brief (for re-order context). design_id on items is the
    //    stable link — prefer that, fall back to art_briefs.item_id.
    const designIds = Array.from(new Set((items || []).map((i: any) => i.design_id).filter(Boolean)));
    const briefByDesign: Record<string, any> = {};
    const briefByItem: Record<string, any> = {};
    if (designIds.length > 0) {
      const { data: byDesign } = await db
        .from("art_briefs")
        .select("id, title, state, design_id, item_id")
        .in("design_id", designIds);
      for (const b of (byDesign || [])) briefByDesign[b.design_id] = b;
    }
    if (itemIds.length > 0) {
      const { data: byItem } = await db
        .from("art_briefs")
        .select("id, title, state, item_id")
        .in("item_id", itemIds);
      for (const b of (byItem || [])) briefByItem[b.item_id] = b;
    }

    // 7. Build the output — one row per item, sanitized for client view.
    const out = (items || []).map((it: any) => {
      const job = jobById[it.job_id] || {};
      const brief = (it.design_id && briefByDesign[it.design_id]) || briefByItem[it.id] || null;
      return {
        id: it.id,
        name: it.name || "Untitled",
        garment_type: it.garment_type || null,
        mockup_color: it.mockup_color || null,
        qty: qtyByItem[it.id] || 0,
        status: resolveItemStatus({
          archived_at: it.archived_at,
          pipeline_stage: it.pipeline_stage,
          sell_per_unit: it.sell_per_unit != null ? Number(it.sell_per_unit) : null,
          blanks_order_cost: it.blanks_order_cost != null ? Number(it.blanks_order_cost) : null,
          job_phase: job.phase || null,
          job_shipping_route: job.shipping_route || null,
          job_completed_at: (job.phase_timestamps as any)?.complete || null,
        }),
        thumb_id: thumbByItem[it.id] || null,
        created_at: it.created_at,
        client_eta: it.client_eta || null,
        client_eta_note: it.client_eta_note || null,
        archived_at: it.archived_at || null,
        job: {
          id: it.job_id,
          job_number: job.job_number || null,
          title: job.title || null,
          phase: job.phase || null,
          target_ship_date: job.target_ship_date || null,
          completed_at: (job as any).phase_timestamps?.complete || null,
        },
        brief: brief ? { id: brief.id, title: brief.title, state: brief.state } : null,
        design_id: it.design_id || null,
      };
    });

    return NextResponse.json({
      client: { name: client.name },
      items: out,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
