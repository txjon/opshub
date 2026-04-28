import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { calculatePhase } from "@/lib/lifecycle";
import { logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/move
// Body: { to_job_id: string }
//
// Transfers a single item from its current job to another job belonging to
// the SAME client. Validated server-side — we never trust a client-supplied
// source_job or skip the client match.
//
// What moves with the item (automatic via FKs, nothing to do):
//   - item_files (art, mockups, proofs, print-ready) — linked by item_id
//   - buy_sheet_lines (per-size qty) — linked by item_id
//   - decorator_assignments — linked by item_id
//   - art_briefs.item_id — brief follows the item
//   - inventory_records — linked by item_id
//
// What we migrate explicitly:
//   - items.job_id (the move itself)
//   - items.sort_order (append to end of dest)
//   - costing_data.costProds entry — moved from source.costProds to dest.costProds
//     (matched by item.id, with name fallback for legacy costing data)
//   - phase on both jobs (recalc from scratch)
//   - activity log on both jobs

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

    // 1. Load the item + its current job. The source job_id comes from the
    //    item row — never from the caller.
    const { data: item, error: itemErr } = await db
      .from("items")
      .select("id, job_id, name")
      .eq("id", params.id)
      .single();
    if (itemErr || !item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    const sourceJobId = item.job_id;
    if (!sourceJobId) return NextResponse.json({ error: "Item has no source job" }, { status: 400 });
    if (sourceJobId === to_job_id) return NextResponse.json({ error: "Source and destination are the same" }, { status: 400 });

    // 2. Load source + destination jobs (full rows — we need costing_data,
    //    client_id, job_number).
    const { data: jobs, error: jobsErr } = await db
      .from("jobs")
      .select("id, job_number, title, client_id, costing_data, costing_summary, phase")
      .in("id", [sourceJobId, to_job_id]);
    if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 500 });
    const sourceJob = (jobs || []).find((j: any) => j.id === sourceJobId);
    const destJob = (jobs || []).find((j: any) => j.id === to_job_id);
    if (!sourceJob) return NextResponse.json({ error: "Source job not found" }, { status: 404 });
    if (!destJob) return NextResponse.json({ error: "Destination job not found" }, { status: 404 });

    // 3. HARD GUARD: same client. Never move items across clients.
    if (sourceJob.client_id !== destJob.client_id) {
      return NextResponse.json(
        { error: "Can only move items between jobs for the same client" },
        { status: 403 }
      );
    }

    // 4. Migrate the costProd (if present) from source costing_data to dest.
    //    Match by item.id first, fall back to name match (legacy costing data
    //    sometimes has recreated ids).
    const sourceCosting = (sourceJob.costing_data || { costProds: [] }) as any;
    const destCosting = (destJob.costing_data || { costProds: [] }) as any;
    const sourceCostProds: any[] = Array.isArray(sourceCosting.costProds) ? sourceCosting.costProds : [];
    const destCostProds: any[] = Array.isArray(destCosting.costProds) ? destCosting.costProds : [];

    let migratedCostProd: any = null;
    let migratedIdx = sourceCostProds.findIndex((cp: any) => cp.id === item.id);
    if (migratedIdx < 0) {
      // Name fallback — case-insensitive trim
      const nameKey = (item.name || "").trim().toLowerCase();
      if (nameKey) {
        migratedIdx = sourceCostProds.findIndex((cp: any) => (cp.name || "").trim().toLowerCase() === nameKey);
      }
    }
    if (migratedIdx >= 0) {
      migratedCostProd = sourceCostProds[migratedIdx];
      sourceCostProds.splice(migratedIdx, 1);
      // Carry the costProd forward, but reset fields that are tied to the
      // source job's specific blank/decorator assignment. The destination
      // CostingTab will rebuild these from the item row + catalog on first
      // open. Custom costs, specialties, and print locations survive — those
      // are authored on the item itself, not derived from the job.
      // Strip source-specific blank costs so the destination CostingTab
      // pulls fresh from items.blank_costs (source of truth on the item row).
      // Without this, a tote bag moved from a shirt job inherits $51/unit
      // phantom blanks and wrecks the margin math.
      // printVendor + customCosts + specialties + printLocations stay —
      // those are item-authored and usually apply post-move.
      const cleaned = {
        ...migratedCostProd,
        id: item.id,
        blankCosts: {},
        blankCostPerUnit: 0,
      };
      destCostProds.push(cleaned);
    }

    // 5. Calculate next sort_order in destination (append to end, gap-friendly).
    const { data: destItems } = await db
      .from("items")
      .select("sort_order")
      .eq("job_id", to_job_id)
      .order("sort_order", { ascending: false })
      .limit(1);
    const maxSort = destItems?.[0]?.sort_order;
    const nextSort = (typeof maxSort === "number" ? maxSort : 0) + 10;

    // 6. Execute the move. We do these sequentially — if the item update
    //    succeeds but a side-effect fails, the move is still functionally
    //    complete (the item belongs to the dest job, files follow via FK).
    //    The side-effects are cleanup that can be re-run safely.
    // NOTE: items table has no updated_at column — don't set it here.
    const { error: moveErr } = await db
      .from("items")
      .update({ job_id: to_job_id, sort_order: nextSort })
      .eq("id", item.id);
    if (moveErr) return NextResponse.json({ error: moveErr.message }, { status: 500 });

    // 7. Update both jobs' costing_data. We do NOT touch costing_summary —
    //    it's a display aggregate that'll refresh on next costing save. A
    //    slight staleness beats risking bad totals from a partial move.
    const updates = [
      db.from("jobs").update({
        costing_data: { ...sourceCosting, costProds: sourceCostProds },
        updated_at: new Date().toISOString(),
      }).eq("id", sourceJobId).then(r => r),
      db.from("jobs").update({
        costing_data: { ...destCosting, costProds: destCostProds },
        updated_at: new Date().toISOString(),
      }).eq("id", to_job_id).then(r => r),
    ];
    await Promise.all(updates).catch(e => {
      // Log but don't block — the move already succeeded. Return a note so
      // the caller can surface a warning if they care.
      console.error("[item move] costing_data update failed:", e);
    });

    // 8. Recalc phase on both jobs.
    await Promise.all([
      recalcPhase(db, sourceJobId),
      recalcPhase(db, to_job_id),
    ]).catch(e => {
      console.error("[item move] phase recalc failed:", e);
    });

    // 9. Log activity on both sides.
    try {
      await Promise.all([
        logJobActivityServer(sourceJobId,
          `Item "${item.name || "(unnamed)"}" moved to ${destJob.job_number || destJob.title || "another job"}`),
        logJobActivityServer(to_job_id,
          `Item "${item.name || "(unnamed)"}" moved in from ${sourceJob.job_number || sourceJob.title || "another job"}`),
      ]);
    } catch (e) {
      console.error("[item move] activity log failed:", e);
    }

    // 10. Return the updated item + summary for the UI.
    const { data: updatedItem } = await db
      .from("items")
      .select("id, job_id, sort_order, name")
      .eq("id", item.id)
      .single();

    return NextResponse.json({
      success: true,
      item: updatedItem,
      from: { id: sourceJobId, job_number: sourceJob.job_number, title: sourceJob.title },
      to: { id: to_job_id, job_number: destJob.job_number, title: destJob.title },
      costing_migrated: !!migratedCostProd,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Move failed" }, { status: 500 });
  }
}

// Server-side phase recalc — mirrors lib/use-warehouse.ts::recalcJobPhase
// but uses the admin client (bypasses RLS on cross-job writes).
async function recalcPhase(db: ReturnType<typeof admin>, jobId: string) {
  const { data: jobData } = await db
    .from("jobs")
    .select("job_type, shipping_route, payment_terms, quote_approved, phase, fulfillment_status, type_meta, costing_data, phase_timestamps")
    .eq("id", jobId)
    .single();
  if (!jobData || jobData.phase === "on_hold" || jobData.phase === "cancelled") return;

  const { data: jobItems } = await db
    .from("items")
    .select("id, pipeline_stage, blanks_order_number, blanks_order_cost, ship_tracking, received_at_hpd, artwork_status, garment_type")
    .eq("job_id", jobId);

  const { data: payments } = await db
    .from("payment_records")
    .select("amount, status")
    .eq("job_id", jobId);

  const { data: proofFiles } = await db
    .from("item_files")
    .select("item_id, approval")
    .eq("stage", "proof")
    .is("superseded_at", null)
    .in("item_id", (jobItems || []).map((it: any) => it.id));

  const proofStatus: Record<string, { allApproved: boolean }> = {};
  for (const it of (jobItems || [])) {
    const manualApproved = it.artwork_status === "approved";
    const proofs = (proofFiles || []).filter((f: any) => f.item_id === it.id);
    proofStatus[it.id] = {
      allApproved: manualApproved || (proofs.length > 0 && proofs.every((f: any) => f.approval === "approved")),
    };
  }

  const costProds = ((jobData.costing_data as any)?.costProds || []) as any[];
  const vendors = Array.from(new Set(costProds.map(cp => cp.printVendor).filter(Boolean)));

  const result = calculatePhase({
    job: {
      job_type: jobData.job_type,
      shipping_route: jobData.shipping_route || "ship_through",
      payment_terms: jobData.payment_terms,
      quote_approved: jobData.quote_approved || false,
      phase: jobData.phase,
      fulfillment_status: jobData.fulfillment_status || null,
    },
    items: (jobItems || []).map((it: any) => ({
      id: it.id,
      pipeline_stage: it.pipeline_stage,
      blanks_order_number: it.blanks_order_number,
      blanks_order_cost: it.blanks_order_cost ?? null,
      ship_tracking: it.ship_tracking,
      received_at_hpd: it.received_at_hpd || false,
      artwork_status: it.artwork_status,
      garment_type: it.garment_type,
    })),
    payments: (payments || []).map((p: any) => ({ amount: p.amount, status: p.status })),
    proofStatus,
    poSentVendors: (jobData.type_meta as any)?.po_sent_vendors || [],
    costingVendors: vendors,
  });

  if (result.phase !== jobData.phase) {
    const timestamps = (jobData.phase_timestamps as any) || {};
    timestamps[result.phase] = new Date().toISOString();
    await db.from("jobs").update({ phase: result.phase, phase_timestamps: timestamps }).eq("id", jobId);
  }
}
