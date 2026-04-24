import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/copy
// Body: { to_job_id: string }
//
// Mirror of /move but non-destructive: the source item stays put, a
// fresh copy is created on the destination job. Same-client guard like
// /move — never duplicates across clients.
//
// What gets copied:
//   - items row (new id, new sort_order on dest, fresh status fields)
//   - buy_sheet_lines (qty_ordered carried, ship/receive counters reset to 0)
//   - item_files (new rows, same drive_file_id — files are shared assets,
//     not re-uploaded)
//   - costing_data.costProds entry in dest job (new id matching the new
//     item, blank costs reset so CostingTab pulls fresh from the item row)
//
// What does NOT get copied:
//   - decorator_assignments (destination picks its own vendor)
//   - pipeline_stage / blanks_order_number / tracking (copy is brand new)
//   - drive_link (leave null; new folder gets created on first file upload
//     on the dest item — avoids two items pointing at the same folder)

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { to_job_id } = await req.json();
    if (!to_job_id) return NextResponse.json({ error: "to_job_id required" }, { status: 400 });

    const db = admin();

    // 1. Load source item (full row — we're copying everything).
    const { data: srcItem, error: itemErr } = await db
      .from("items")
      .select("*")
      .eq("id", params.id)
      .single();
    if (itemErr || !srcItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const sourceJobId = srcItem.job_id;
    if (!sourceJobId) return NextResponse.json({ error: "Item has no source job" }, { status: 400 });
    if (sourceJobId === to_job_id) return NextResponse.json({ error: "Source and destination are the same" }, { status: 400 });

    // 2. Source + destination jobs.
    const { data: jobs, error: jobsErr } = await db
      .from("jobs")
      .select("id, job_number, title, client_id, costing_data")
      .in("id", [sourceJobId, to_job_id]);
    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    const sourceJob = (jobs || []).find((j: any) => j.id === sourceJobId);
    const destJob = (jobs || []).find((j: any) => j.id === to_job_id);
    if (!sourceJob) return NextResponse.json({ error: "Source job not found" }, { status: 404 });
    if (!destJob) return NextResponse.json({ error: "Destination job not found" }, { status: 404 });

    // 3. Same-client guard.
    if (sourceJob.client_id !== destJob.client_id) {
      return NextResponse.json({ error: "Can only copy items between jobs for the same client" }, { status: 403 });
    }

    // 4. Pick the next sort_order on the destination.
    const { data: destItems } = await db
      .from("items")
      .select("sort_order")
      .eq("job_id", to_job_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const maxSort = destItems?.[0]?.sort_order;
    const nextSort = (typeof maxSort === "number" ? maxSort : 0) + 10;

    // 5. Insert the new item — carries artwork + blank assignment but
    //    resets pipeline state so the copy starts fresh.
    const { data: newItem, error: insErr } = await db
      .from("items")
      .insert({
        job_id: to_job_id,
        name: srcItem.name,
        blank_vendor: srcItem.blank_vendor,
        blank_sku: srcItem.blank_sku,
        garment_type: srcItem.garment_type,
        sell_per_unit: srcItem.sell_per_unit,
        cost_per_unit: srcItem.cost_per_unit,
        blank_costs: srcItem.blank_costs,
        mockup_color: srcItem.mockup_color,
        notes: srcItem.notes,
        production_notes_po: srcItem.production_notes_po,
        incoming_goods: srcItem.incoming_goods,
        packing_notes: srcItem.packing_notes,
        sort_order: nextSort,
        status: "tbd",
        artwork_status: "not_started",
        pipeline_stage: null,
        blanks_order_number: null,
        ship_tracking: null,
        drive_link: null,
      })
      .select("*")
      .single();
    if (insErr || !newItem) return NextResponse.json({ error: insErr?.message || "Insert failed" }, { status: 500 });

    // 6. Copy buy_sheet_lines — qty_ordered carries, shipped/received reset.
    const { data: srcLines } = await db
      .from("buy_sheet_lines")
      .select("size, qty_ordered")
      .eq("item_id", srcItem.id);
    if ((srcLines || []).length > 0) {
      await db.from("buy_sheet_lines").insert(
        (srcLines || []).map((l: any) => ({
          item_id: newItem.id,
          size: l.size,
          qty_ordered: l.qty_ordered,
          qty_shipped_from_vendor: 0,
          qty_received_at_hpd: 0,
          qty_shipped_to_customer: 0,
        }))
      );
    }

    // 7. Copy item_files — files are shared assets, same drive_file_id.
    // drive_link is NOT NULL on the table — fall back to the standard
    // Drive view URL if the source row ever lost it.
    const { data: srcFiles } = await db
      .from("item_files")
      .select("file_name, stage, drive_file_id, drive_link, mime_type, file_size")
      .eq("item_id", srcItem.id)
      .is("superseded_at", null);
    if ((srcFiles || []).length > 0) {
      const { error: filesErr } = await db.from("item_files").insert(
        (srcFiles || []).map((f: any) => ({
          item_id: newItem.id,
          file_name: f.file_name,
          stage: f.stage,
          drive_file_id: f.drive_file_id,
          drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
          mime_type: f.mime_type || null,
          file_size: f.file_size || null,
          // Reset approval — destination needs its own client sign-off
          approval: "none",
        }))
      );
      if (filesErr) console.error("[item copy] item_files insert failed:", filesErr.message);
    }

    // 8. Copy the costProd into the destination costing_data (rebind to the
    //    new item.id). Blank costs stripped — CostingTab rebuilds on open.
    const destCosting = (destJob.costing_data || { costProds: [] }) as any;
    const destCostProds: any[] = Array.isArray(destCosting.costProds) ? destCosting.costProds : [];
    const sourceCosting = (sourceJob.costing_data || { costProds: [] }) as any;
    const sourceCostProds: any[] = Array.isArray(sourceCosting.costProds) ? sourceCosting.costProds : [];
    let matched = sourceCostProds.find((cp: any) => cp.id === srcItem.id);
    if (!matched) {
      const nameKey = (srcItem.name || "").trim().toLowerCase();
      matched = sourceCostProds.find((cp: any) => (cp.name || "").trim().toLowerCase() === nameKey);
    }
    if (matched) {
      destCostProds.push({ ...matched, id: newItem.id, blankCosts: {}, blankCostPerUnit: 0 });
      await db.from("jobs").update({
        costing_data: { ...destCosting, costProds: destCostProds },
        updated_at: new Date().toISOString(),
      }).eq("id", to_job_id);
    }

    // 9. Activity logs on both ends.
    try {
      await Promise.all([
        logJobActivityServer(sourceJobId,
          `Item "${srcItem.name || "(unnamed)"}" copied to ${destJob.job_number || destJob.title || "another job"}`),
        logJobActivityServer(to_job_id,
          `Item "${srcItem.name || "(unnamed)"}" copied in from ${sourceJob.job_number || sourceJob.title || "another job"}`),
      ]);
    } catch (e) {
      console.error("[item copy] activity log failed:", e);
    }

    return NextResponse.json({
      success: true,
      item: { id: newItem.id, job_id: newItem.job_id, name: newItem.name, sort_order: newItem.sort_order },
      from: { id: sourceJobId, job_number: sourceJob.job_number, title: sourceJob.title },
      to: { id: to_job_id, job_number: destJob.job_number, title: destJob.title },
      costing_migrated: !!matched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Copy failed" }, { status: 500 });
  }
}
