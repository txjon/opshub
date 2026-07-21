import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE CUT — the pre-item → item promotion (auth gate + service-role writes,
// mirrors /api/jobs/[id]/duplicate).
//
// POST /api/drops/[releaseId]/cut
// Gate: status ready|closed AND every slot has production qtys (> 0 units).
// Births ONE job (intake) + one item per slot:
//   - item name = "{idea title} {format}", design_id = brief id,
//     artwork_status approved (the gate guaranteed the design was)
//   - buy_sheet_lines from slot.qtys (the client's numbers)
//   - newest client-visible image on the idea copied to item_files as the
//     mockup (same drive id — files are shared, ref-counted deletion)
// Stamps slots.item_id + qtys_confirmed_at, release.job_id/status cut.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(_req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const { data: release } = await db.from("releases")
      .select("*, clients(id, name, default_terms)").eq("id", params.releaseId).single();
    if (!release) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!["ready", "closed"].includes((release as any).status)) {
      return NextResponse.json({ error: `Can't cut from ${(release as any).status}` }, { status: 409 });
    }

    const { data: slots } = await db.from("release_slots")
      .select("*, art_briefs(id, title, state)").eq("release_id", (release as any).id).order("sort_order");
    if (!(slots || []).length) return NextResponse.json({ error: "Nothing on the lineup" }, { status: 400 });
    const missing = (slots || []).filter((s: any) => {
      const total = Object.values(s.qtys || {}).reduce((a: number, b: any) => a + (Number(b) || 0), 0);
      return total <= 0;
    });
    if (missing.length) {
      return NextResponse.json({ error: `${missing.length} line${missing.length === 1 ? "" : "s"} still need${missing.length === 1 ? "s" : ""} production numbers` }, { status: 400 });
    }

    // Latest ship-through-style defaults from the client's most recent job.
    const { data: lastJob } = await db.from("jobs")
      .select("job_type, payment_terms, shipping_route")
      .eq("client_id", (release as any).client_id)
      .order("created_at", { ascending: false }).limit(1);

    const { data: newJob, error: jobErr } = await db.from("jobs").insert({
      title: (release as any).title,
      job_type: (lastJob as any)?.[0]?.job_type || null,
      phase: "intake",
      payment_terms: (lastJob as any)?.[0]?.payment_terms || (release as any).clients?.default_terms || null,
      shipping_route: (lastJob as any)?.[0]?.shipping_route || null,
      client_id: (release as any).client_id,
      job_number: "", // trigger assigns
      type_meta: {
        source: "release_cut",
        release_id: (release as any).id,
        release_title: (release as any).title,
      },
      quote_approved: false,
    }).select("id, job_number").single();
    if (jobErr || !newJob) return NextResponse.json({ error: jobErr?.message || "Couldn't create job" }, { status: 500 });
    const jobId = (newJob as any).id;

    const now = new Date().toISOString();
    let itemCount = 0;
    for (let i = 0; i < (slots || []).length; i++) {
      const s: any = (slots || [])[i];
      const ideaTitle = s.art_briefs?.title || "Design";
      const name = `${ideaTitle} ${s.format || "Item"}`.trim().slice(0, 120);
      const { data: item, error: itemErr } = await db.from("items").insert({
        job_id: jobId,
        name,
        status: "tbd",
        artwork_status: "approved",
        sort_order: i,
        pipeline_stage: null,
        design_id: s.brief_id,
        notes: s.line_notes || null,
      }).select("id").single();
      if (itemErr || !item) continue;
      itemCount++;

      const sizes = Object.entries(s.qtys || {})
        .map(([size, qty]) => ({ size: String(size), qty: Math.round(Number(qty) || 0) }))
        .filter(x => x.qty > 0);
      if (sizes.length) {
        await db.from("buy_sheet_lines").insert(sizes.map(x => ({
          item_id: (item as any).id, size: x.size, qty_ordered: x.qty,
          qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
        })));
      }

      // Mockup: newest client-visible, non-PDF image on the idea.
      const { data: bf } = await db.from("art_brief_files")
        .select("file_name, drive_file_id, preview_drive_file_id, drive_link, mime_type, file_size, uploader_role, shared_with_client_at")
        .eq("brief_id", s.brief_id).order("created_at", { ascending: false }).limit(10);
      const pick = (bf || []).find((f: any) => (f.shared_with_client_at || f.uploader_role === "client")
        && (f.preview_drive_file_id || f.drive_file_id) && !/pdf/i.test(f.mime_type || ""));
      if (pick) {
        const driveId = (pick as any).preview_drive_file_id || (pick as any).drive_file_id;
        await db.from("item_files").insert({
          item_id: (item as any).id,
          file_name: (pick as any).file_name || "mockup",
          stage: "mockup",
          drive_file_id: driveId,
          drive_link: (pick as any).drive_link || `https://drive.google.com/file/d/${driveId}/view`,
          mime_type: (pick as any).mime_type || null,
          file_size: (pick as any).file_size || null,
          approval: "none",
        });
      }

      await db.from("release_slots").update({ item_id: (item as any).id, qtys_confirmed_at: now }).eq("id", s.id);
    }

    await db.from("releases").update({
      status: "cut", cut_at: now, job_id: jobId,
      status_timestamps: { ...((release as any).status_timestamps || {}), cut: now },
      updated_at: now,
    }).eq("id", (release as any).id);

    try {
      await logJobActivityServer(jobId,
        `Job born from drop "${(release as any).title}" — ${itemCount} item${itemCount === 1 ? "" : "s"}, quantities from the release numbers.`);
    } catch {}

    return NextResponse.json({ success: true, jobId, jobNumber: (newJob as any).job_number, itemCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
