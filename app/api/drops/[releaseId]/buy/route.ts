import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { logJobActivityServer } from "@/lib/notify-server";
import { sumQtys, enteredSizes } from "@/lib/release-lanes";
import { copyItemIntoJob } from "@/lib/reorder-cart";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE BUY (Continuum Phase 4) — a rolling production order on a pre-order
// release. Unlike the cut (one terminal job), buys happen N times while the
// release sells: sample run → mid-window top-up → close-out true-up. Each
// buy births ONE normal job; its items point home via release_slot_id so
// the line's bought/delivered aggregate automatically.
//
// THE NAMING GATE (hard, per the Continuum): every bought line must carry a
// confirmed FINAL product name — the Shopify join key. Confirming the
// working title is allowed, but it must arrive explicitly in the body; a
// missing name refuses the buy. The slot's format assumes the final name.
//
// POST { buys: [{ slotId, finalName, qtys: { size: n } }] }
//   → { jobId, jobNumber }

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { releaseId: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const db = admin();
    const { data: release } = await db.from("releases")
      .select("*, clients(id, name, default_terms)").eq("id", params.releaseId).single();
    if (!release) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((release as any).status === "cut") return NextResponse.json({ error: "This release is already cut" }, { status: 409 });

    const body = await req.json().catch(() => ({}));
    const buys: { slotId?: string; finalName?: string; qtys?: Record<string, unknown> }[] =
      Array.isArray(body.buys) ? body.buys : [];
    if (!buys.length) return NextResponse.json({ error: "Nothing to buy" }, { status: 400 });

    const { data: slots } = await db.from("release_slots")
      .select("id, brief_id, line_id, item_id, format, line_notes").eq("release_id", (release as any).id);
    const slotById = new Map((slots || []).map((s: any) => [s.id, s]));

    // Validate every line BEFORE creating anything — all-or-nothing.
    for (const b of buys) {
      const slot = slotById.get(String(b.slotId || ""));
      if (!slot) return NextResponse.json({ error: "Line not on this release" }, { status: 404 });
      if (!String(b.finalName || "").trim()) {
        return NextResponse.json({ error: `"${(slot as any).format || "A line"}" needs its final product name confirmed before it can go to production` }, { status: 400 });
      }
      if (sumQtys(b.qtys) <= 0) {
        return NextResponse.json({ error: `"${String(b.finalName).trim()}" has no quantities` }, { status: 400 });
      }
    }

    const { data: lastJob } = await db.from("jobs")
      .select("job_type, payment_terms, shipping_route")
      .eq("client_id", (release as any).client_id)
      .order("created_at", { ascending: false }).limit(1);
    const { count: priorBuys } = await db.from("jobs")
      .select("id", { count: "exact", head: true }).eq("release_id", (release as any).id);

    const { data: newJob, error: jobErr } = await db.from("jobs").insert({
      title: `${(release as any).title} · Buy ${(priorBuys || 0) + 1}`,
      job_type: (lastJob as any)?.[0]?.job_type || null,
      phase: "intake",
      payment_terms: (lastJob as any)?.[0]?.payment_terms || (release as any).clients?.default_terms || null,
      shipping_route: (lastJob as any)?.[0]?.shipping_route || null,
      client_id: (release as any).client_id,
      job_number: "", // trigger assigns
      release_id: (release as any).id,
      type_meta: { source: "release_buy", release_id: (release as any).id, release_title: (release as any).title },
      quote_approved: false,
    }).select("id, job_number").single();
    if (jobErr || !newJob) return NextResponse.json({ error: jobErr?.message || "Couldn't create job" }, { status: 500 });
    const jobId = (newJob as any).id;

    let itemCount = 0;
    for (let i = 0; i < buys.length; i++) {
      const b = buys[i];
      const slot: any = slotById.get(String(b.slotId));
      const finalName = String(b.finalName).trim().slice(0, 120);
      const sizes = enteredSizes(b.qtys);

      // Art rides along (Jon, Aug 23: "none of our art files made it").
      // Source run to copy from: the slot's linked item (pipeline/re-run),
      // else the newest already-attached buy — a rebuy inherits from the
      // prior buy, which inherited from the original.
      let srcId: string | null = slot.item_id || null;
      if (!srcId) {
        const { data: prior } = await db.from("items").select("id")
          .eq("release_slot_id", slot.id).order("created_at", { ascending: false }).limit(1);
        srcId = (prior as any)?.[0]?.id || null;
      }
      let newItemId: string | null = null;
      if (srcId) {
        const { data: src } = await db.from("items").select("*").eq("id", srcId).single();
        if (src) {
          // copyItemIntoJob carries files, vendor/SKU/costs, drive_link,
          // proof spec, and Drive folder shortcuts — same engine as the cut
          // and the reorder cart. Name overridden to the confirmed final.
          newItemId = await copyItemIntoJob(db, { ...(src as any), name: finalName }, jobId, {
            sizes, sortOrder: i,
            drive: { clientName: (release as any).clients?.name || "", projectTitle: `${(release as any).title} · Buy ${(priorBuys || 0) + 1}` },
          });
          if (newItemId) {
            await db.from("items").update({ release_slot_id: slot.id, notes: slot.line_notes || null }).eq("id", newItemId);
          }
        }
      }
      if (!newItemId) {
        // Brief-only line, no prior run — bare item + the idea's newest
        // client-visible mockup (mirrors the cut route).
        const { data: item, error: itemErr } = await db.from("items").insert({
          job_id: jobId,
          name: finalName,
          status: "tbd",
          artwork_status: "approved",
          sort_order: i,
          pipeline_stage: null,
          design_id: slot.brief_id || null,
          release_slot_id: slot.id,
          notes: slot.line_notes || null,
        }).select("id").single();
        if (itemErr || !item) continue;
        newItemId = (item as any).id;
        if (sizes.length) {
          await db.from("buy_sheet_lines").insert(sizes.map(x => ({
            item_id: newItemId, size: x.size, qty_ordered: x.qty,
            qty_shipped_from_vendor: 0, qty_received_at_hpd: 0, qty_shipped_to_customer: 0,
          })));
        }
        if (slot.brief_id) {
          const { data: bf } = await db.from("art_brief_files")
            .select("file_name, drive_file_id, preview_drive_file_id, drive_link, mime_type, file_size, uploader_role, shared_with_client_at")
            .eq("brief_id", slot.brief_id).order("created_at", { ascending: false }).limit(10);
          const pick = (bf || []).find((f: any) => (f.shared_with_client_at || f.uploader_role === "client")
            && (f.preview_drive_file_id || f.drive_file_id) && !/pdf/i.test(f.mime_type || ""));
          if (pick) {
            const driveId = (pick as any).preview_drive_file_id || (pick as any).drive_file_id;
            await db.from("item_files").insert({
              item_id: newItemId,
              file_name: (pick as any).file_name || "mockup",
              stage: "mockup",
              drive_file_id: driveId,
              drive_link: (pick as any).drive_link || `https://drive.google.com/file/d/${driveId}/view`,
              mime_type: (pick as any).mime_type || null,
              file_size: (pick as any).file_size || null,
              approval: "none",
            });
          }
        }
      }
      itemCount++;
      // The product assumes its final name (one rename, one moment).
      if (slot.format !== finalName) {
        await db.from("release_slots").update({ format: finalName }).eq("id", slot.id);
      }
    }
    if (!itemCount) {
      await db.from("jobs").delete().eq("id", jobId);
      return NextResponse.json({ error: "No items could be created" }, { status: 500 });
    }

    await db.from("releases").update({ updated_at: new Date().toISOString() }).eq("id", (release as any).id);
    try {
      await logJobActivityServer(jobId,
        `Buy ${(priorBuys || 0) + 1} on release "${(release as any).title}" — ${itemCount} line${itemCount === 1 ? "" : "s"}, quantities from the pre-order ledger.`);
    } catch {}

    return NextResponse.json({ jobId, jobNumber: (newJob as any).job_number, items: itemCount });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
