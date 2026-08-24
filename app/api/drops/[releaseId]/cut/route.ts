import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";
import { isPipelineSlot, isRerunSlot, sumQtys, enteredSizes, productIdOfSlot } from "@/lib/release-lanes";
import { copyItemIntoJob } from "@/lib/reorder-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE CUT — the pre-item → item promotion (auth gate + service-role writes,
// mirrors /api/jobs/[id]/duplicate).
//
// POST /api/drops/[releaseId]/cut
// Gate: status ready|closed AND every cuttable slot has qtys (> 0 units).
// Births ONE job (intake) + one item per non-pipeline slot, by lane:
//   - brief lines: item name = "{idea title} {format}", design_id = brief id,
//     artwork_status approved, newest client-visible idea image → mockup
//   - RE-RUNS (line_id "rerun:…"): the past item copied whole via
//     copyItemIntoJob (blanks, costs, art files by reference) — born
//     press-ready with the client's numbers
//   - pipeline slots: never re-made; they ride for launch timing only
// Stamps slots.item_id (re-runs restamp to the BORN item; the source stays
// in line_id) + qtys_confirmed_at, release.job_id/status cut.

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
    // Pipeline slots are ALREADY in production on their own jobs — the cut
    // never re-creates them. It births brief lines AND catalog re-runs.
    const toCreate = (slots || []).filter((s: any) => !isPipelineSlot(s));
    if (!toCreate.length) {
      return NextResponse.json({ error: "Every line is already in production — nothing to cut. This release just launches when it launches." }, { status: 400 });
    }
    const missing = toCreate.filter((s: any) => sumQtys(s.qtys) <= 0);
    if (missing.length) {
      return NextResponse.json({ error: `${missing.length} line${missing.length === 1 ? "" : "s"} still need${missing.length === 1 ? "s" : ""} production numbers` }, { status: 400 });
    }

    // Latest ship-through-style defaults from the client's most recent job.
    const { data: lastJob } = await db.from("jobs")
      .select("id, job_type, payment_terms, shipping_route")
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

    // Contacts ride along (Jon, Aug 23: cut job had no invoice recipients) —
    // same rule as the reorder cart: copy from the client's latest job.
    const srcJobId = (lastJob as any)?.[0]?.id;
    if (srcJobId) {
      const { data: srcContacts } = await db.from("job_contacts").select("contact_id, role_on_job").eq("job_id", srcJobId);
      if ((srcContacts || []).length) {
        await db.from("job_contacts").insert((srcContacts || []).map((c: any) => ({
          job_id: jobId, contact_id: c.contact_id, role_on_job: c.role_on_job,
        })));
      }
    }

    // Re-run sources fetched up front — copyItemIntoJob wants the full row.
    const rerunSrcIds = toCreate.filter(isRerunSlot).map((s: any) => s.item_id).filter(Boolean);
    const srcById: Record<string, any> = {};
    if (rerunSrcIds.length) {
      const { data: srcs } = await db.from("items").select("*").in("id", rerunSrcIds);
      for (const it of (srcs || []) as any[]) srcById[it.id] = it;
    }

    const now = new Date().toISOString();
    let itemCount = 0;
    for (let i = 0; i < (slots || []).length; i++) {
      const s: any = (slots || [])[i];
      if (isPipelineSlot(s)) { await db.from("release_slots").update({ qtys_confirmed_at: now }).eq("id", s.id); continue; }

      if (isRerunSlot(s)) {
        // Catalog re-run: copy the past item whole — art rides along, and
        // since its proofs copy as approved it's born press-ready.
        const src = srcById[s.item_id];
        if (!src) continue;
        const sizes = enteredSizes(s.qtys);
        const newId = await copyItemIntoJob(db, src, jobId, {
          sizes, sortOrder: i,
          drive: { clientName: (release as any).clients?.name || "", projectTitle: (release as any).title || "" },
        });
        if (!newId) continue;
        itemCount++;
        await db.from("release_slots").update({ item_id: newId, qtys_confirmed_at: now }).eq("id", s.id);
        continue;
      }

      // Product slots (Phase 5) carry the product's own identity.
      const slotProductId = productIdOfSlot(s);
      let slotProduct: any = null;
      if (slotProductId) {
        const { data: sp } = await db.from("products").select("id, title, spec").eq("id", slotProductId).single();
        slotProduct = sp || null;
      }
      const ideaTitle = s.art_briefs?.title || "Design";
      const name = (slotProduct?.title || `${ideaTitle} ${s.format || "Item"}`).trim().slice(0, 120);
      const { data: item, error: itemErr } = await db.from("items").insert({
        job_id: jobId,
        name,
        status: "tbd",
        artwork_status: "approved",
        sort_order: i,
        pipeline_stage: null,
        design_id: s.brief_id,
        product_id: slotProduct?.id || null,
        notes: s.line_notes || null,
      }).select("id").single();
      if (itemErr || !item) continue;
      itemCount++;

      const sizes = enteredSizes(s.qtys);
      if (sizes.length) {
        await db.from("buy_sheet_lines").insert(sizes.map(x => ({
          item_id: (item as any).id, size: x.size, qty_ordered: x.qty,
          qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
        })));
      }

      // Mockup: the product's own comp image first, else the idea's newest
      // client-visible non-PDF image.
      const prodMock = slotProduct?.spec?.mockup_drive_file_id;
      if (prodMock) {
        await db.from("item_files").insert({
          item_id: (item as any).id, file_name: `${name} mockup`, stage: "mockup",
          drive_file_id: prodMock, drive_link: `https://drive.google.com/file/d/${prodMock}/view`,
          approval: "none",
        });
      }
      const { data: bf } = prodMock ? { data: [] as any[] } : await db.from("art_brief_files")
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
