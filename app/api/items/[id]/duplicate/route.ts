import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/duplicate
//
// Same-job clone of an item. Mirrors /api/items/[id]/copy but skips
// the cross-job + same-client guards since source and destination
// are the same job.
//
// What gets duplicated:
//   - items row (new id, sort_order placed immediately after source,
//     fresh status fields, " (Copy)" appended to the name so the
//     two items are distinguishable on the buy sheet)
//   - buy_sheet_lines (qty_ordered carried, ship/receive counters reset)
//   - item_files (new rows pointing at the same drive_file_id —
//     files are shared assets)
//   - costing_data.costProds entry rebound to the new item id, blank
//     costs stripped so CostingTab rebuilds fresh
//
// What does NOT get duplicated:
//   - decorator_assignments (start clean)
//   - pipeline_stage / blanks_order_number / tracking
//   - drive_link (new folder will be created on first upload)

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();

    const { data: srcItem, error: itemErr } = await db
      .from("items")
      .select("*")
      .eq("id", params.id)
      .single();
    if (itemErr || !srcItem) return NextResponse.json({ error: "Item not found" }, { status: 404 });
    const jobId = (srcItem as any).job_id;
    if (!jobId) return NextResponse.json({ error: "Item has no source job" }, { status: 400 });

    const { data: job } = await db
      .from("jobs")
      .select("id, costing_data")
      .eq("id", jobId)
      .single();

    // Pick a sort_order slot just after the source so the duplicate
    // shows up next to the original instead of at the bottom. Bump
    // every item with sort_order > source up by 10 to make room. Cheap
    // since these tables stay small per job.
    const { data: siblings } = await db
      .from("items")
      .select("id, sort_order")
      .eq("job_id", jobId)
      .order("sort_order", { ascending: true });
    const srcSort = (srcItem as any).sort_order ?? 0;
    const newSort = srcSort + 5;
    const toBump = (siblings || [])
      .filter((s: any) => typeof s.sort_order === "number" && s.sort_order > srcSort && s.sort_order <= newSort)
      .map((s: any) => s.id);
    if (toBump.length > 0) {
      // Bump in one shot — array-of-ids update with shifted values via
      // RPC would be nicer, but a per-row update is fine at this scale.
      await Promise.all(toBump.map((id: string) =>
        db.from("items").update({ sort_order: srcSort + 100 }).eq("id", id)
      ));
    }

    const { data: newItem, error: insErr } = await db
      .from("items")
      .insert({
        job_id: jobId,
        name: ((srcItem as any).name ? `${(srcItem as any).name} (Copy)` : "(Copy)"),
        blank_vendor: (srcItem as any).blank_vendor,
        blank_sku: (srcItem as any).blank_sku,
        garment_type: (srcItem as any).garment_type,
        sell_per_unit: (srcItem as any).sell_per_unit,
        cost_per_unit: (srcItem as any).cost_per_unit,
        blank_costs: (srcItem as any).blank_costs,
        mockup_color: (srcItem as any).mockup_color,
        notes: (srcItem as any).notes,
        production_notes_po: (srcItem as any).production_notes_po,
        incoming_goods: (srcItem as any).incoming_goods,
        packing_notes: (srcItem as any).packing_notes,
        sort_order: newSort,
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

    const { data: srcLines } = await db
      .from("buy_sheet_lines")
      .select("size, qty_ordered")
      .eq("item_id", (srcItem as any).id);
    if ((srcLines || []).length > 0) {
      await db.from("buy_sheet_lines").insert(
        (srcLines || []).map((l: any) => ({
          item_id: (newItem as any).id,
          size: l.size,
          qty_ordered: l.qty_ordered,
          qty_shipped_from_vendor: 0,
          qty_received_at_hpd: 0,
          qty_shipped_to_customer: 0,
        }))
      );
    }

    const { data: srcFiles } = await db
      .from("item_files")
      .select("file_name, stage, drive_file_id, drive_link, mime_type, file_size")
      .eq("item_id", (srcItem as any).id)
      .is("superseded_at", null);
    if ((srcFiles || []).length > 0) {
      const { error: filesErr } = await db.from("item_files").insert(
        (srcFiles || []).map((f: any) => ({
          item_id: (newItem as any).id,
          file_name: f.file_name,
          stage: f.stage,
          drive_file_id: f.drive_file_id,
          drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
          mime_type: f.mime_type || null,
          file_size: f.file_size || null,
          approval: "none",
        }))
      );
      if (filesErr) console.error("[item duplicate] item_files insert failed:", filesErr.message);
    }

    // Mirror the costProd entry for the new item id so CostingTab
    // shows pricing immediately on the duplicate (same decoration
    // pattern, blank costs cleared so it rebuilds from items row).
    const costing = ((job as any)?.costing_data || { costProds: [] }) as any;
    const costProds: any[] = Array.isArray(costing.costProds) ? costing.costProds : [];
    let matched = costProds.find((cp: any) => cp.id === (srcItem as any).id);
    if (!matched) {
      const nameKey = ((srcItem as any).name || "").trim().toLowerCase();
      matched = costProds.find((cp: any) => (cp.name || "").trim().toLowerCase() === nameKey);
    }
    if (matched) {
      const dupCp = { ...matched, id: (newItem as any).id, name: (newItem as any).name, blankCosts: {}, blankCostPerUnit: 0 };
      const insertAt = costProds.findIndex((cp: any) => cp.id === (srcItem as any).id);
      const nextProds = insertAt >= 0
        ? [...costProds.slice(0, insertAt + 1), dupCp, ...costProds.slice(insertAt + 1)]
        : [...costProds, dupCp];
      await db.from("jobs").update({
        costing_data: { ...costing, costProds: nextProds },
        updated_at: new Date().toISOString(),
      }).eq("id", jobId);
    }

    try {
      await logJobActivityServer(jobId,
        `Item "${(srcItem as any).name || "(unnamed)"}" duplicated as "${(newItem as any).name}"`);
    } catch (e) {
      console.error("[item duplicate] activity log failed:", e);
    }

    return NextResponse.json({
      success: true,
      item: { id: (newItem as any).id, job_id: (newItem as any).job_id, name: (newItem as any).name, sort_order: (newItem as any).sort_order },
      costing_migrated: !!matched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Duplicate failed" }, { status: 500 });
  }
}
