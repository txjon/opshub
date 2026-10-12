import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { logJobActivityServer } from "@/lib/notify-server";
import { addItemsToJob } from "@/lib/reorder-cart";

export const dynamic = "force-dynamic";

// POST /api/items/[id]/copy   Body: { to_job_id: string }
//
// The item ⋯ "Copy to another project": a fresh copy on the destination job,
// source untouched. Runs on lib/reorder-cart addItemsToJob — the SAME engine
// as the cart, reorders and job duplicate (Oct 2026; this route used to
// hand-roll its own copy, which dropped the fleece flag / blank supplier /
// design link, never built the Drive folder, reset a carried approval and
// stored quantity copies in costing). Same client only; the destination must
// still be editable (not quoted/approved). The source may be locked.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { to_job_id } = await req.json().catch(() => ({}));
    if (!to_job_id) return NextResponse.json({ error: "to_job_id required" }, { status: 400 });

    const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: src } = await db.from("items").select("id, job_id, name, jobs(id, job_number, title)").eq("id", params.id).single();
    if (!src) return NextResponse.json({ error: "Item not found" }, { status: 404 });

    const r = await addItemsToJob(db, { jobId: to_job_id, items: [{ itemId: params.id }] });
    const a = r.added[0];
    const sourceJob: any = (src as any).jobs || {};

    try {
      await Promise.all([
        logJobActivityServer(sourceJob.id, `Item "${src.name || "(unnamed)"}" copied to ${r.job.job_number || r.job.title || "another job"}`),
        logJobActivityServer(r.job.id, `Item "${src.name || "(unnamed)"}" copied in from ${a.fromJob || sourceJob.job_number || "another job"}`),
      ]);
    } catch (e) { console.error("[item copy] activity log failed:", e); }

    return NextResponse.json({
      success: true,
      item: { id: a.newId, job_id: r.job.id, name: a.name },
      from: { id: sourceJob.id, job_number: sourceJob.job_number, title: sourceJob.title },
      to: { id: r.job.id, job_number: r.job.job_number, title: r.job.title },
      fileErrors: r.fileErrors,
    });
  } catch (e: any) {
    const msg = e?.message || "Copy failed";
    const code = /not found/i.test(msg) ? 404 : /same client|already quoted|already on this job|Nothing to add/i.test(msg) ? 400 : 500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
