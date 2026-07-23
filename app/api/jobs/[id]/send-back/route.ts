import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createServiceClient } from "@supabase/supabase-js";

// SEND BACK TO STUDIO (Jon, Jul 22) — the inverse of a studio greenlight.
// A greenlight was premature (wrong art, not ready, a test); this un-births the
// job back into an editable idea in the studio so the ping-pong can resume.
//
// Reverses exactly what lib/products-server.ts wrote:
//   - deletes the job (FK cascade removes items → buy_sheet_lines + item_files,
//     and job_contacts — all ON DELETE CASCADE)
//   - deletes the products born from the brief (only if nothing else references
//     them — no reorder items, no flip children)
//   - restores the brief to state "draft" (back in the studio, iterate again)
//   - logs a durable note on the brief thread
// It does NOT touch Drive files (the brief still owns those ref-counted files).
//
// GUARDS: only greenlight-origin jobs, and only while still early — refuses once
// there's real, irreversible progress (production / receiving / payments).

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const sb = await createClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const jobId = params.id;
    const { data: job } = await sb.from("jobs")
      .select("id, job_number, title, phase, type_meta, items(id, design_id, product_id, pipeline_stage, received_at_hpd), payment_records(id)")
      .eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const items = ((job as any).items || []) as any[];
    const source = ((job as any).type_meta || {}).source || "";
    const briefId = ((job as any).type_meta || {}).brief_id || items.find(i => i.design_id)?.design_id || null;

    // Must be a greenlight-born job with a brief to go back to.
    const isGreenlightOrigin = /greenlight/i.test(source) || items.some(i => i.design_id);
    if (!isGreenlightOrigin || !briefId) {
      return NextResponse.json({ error: "This job didn't come from a studio idea, so there's no studio to send it back to." }, { status: 400 });
    }

    // Refuse once there's real progress — sending back is only for early jobs.
    const advancedPhases = ["production", "receiving", "shipping", "fulfillment", "complete"];
    const producing = items.some(i => i.pipeline_stage === "in_production" || i.pipeline_stage === "shipped" || i.received_at_hpd);
    const paid = ((job as any).payment_records || []).length > 0;
    if (advancedPhases.includes((job as any).phase) || producing || paid) {
      return NextResponse.json({ error: "This job has already moved into production or taken a payment — it can't be sent back to the studio. Put it on hold or cancel it instead." }, { status: 409 });
    }

    // Service role for the multi-table reversal (auth already enforced above).
    const db = createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // The brief we're reopening. Guard its legacy self-links: art_briefs.job_id /
    // .item_id are ON DELETE CASCADE, so if this brief was ever created UNDER a
    // job, deleting the job would cascade-delete the brief. Null them first so
    // the delete can never reach the brief. (Studio-born briefs are already null.)
    const { data: brief } = await db.from("art_briefs").select("id, state, job_id, item_id").eq("id", briefId).single();
    if (!brief) return NextResponse.json({ error: "The studio idea behind this job no longer exists." }, { status: 404 });
    if ((brief as any).job_id || (brief as any).item_id) {
      await db.from("art_briefs").update({ job_id: null, item_id: null } as never).eq("id", briefId);
    }

    // Products born from this brief — remember them, then decide what's safe to
    // delete AFTER the job (and its items) are gone.
    const { data: briefProducts } = await db.from("products").select("id").eq("brief_id", briefId);
    const productIds = (briefProducts || []).map((p: any) => p.id);

    // 1. Delete the job — cascade clears items, buy_sheet_lines, item_files, job_contacts.
    const { error: delErr } = await db.from("jobs").delete().eq("id", jobId);
    if (delErr) return NextResponse.json({ error: delErr.message || "Couldn't remove the job." }, { status: 500 });

    // 2. Un-birth the products, but only the ones nothing else needs: no surviving
    //    item points at them (a reorder on another job), and no product is their
    //    flip child. Leave any that are still referenced.
    let productsRemoved = 0;
    for (const pid of productIds) {
      const { count: refItems } = await db.from("items").select("id", { count: "exact", head: true }).eq("product_id", pid);
      const { count: refFlips } = await db.from("products").select("id", { count: "exact", head: true }).eq("parent_product_id", pid);
      if ((refItems || 0) === 0 && (refFlips || 0) === 0) {
        await db.from("products").delete().eq("id", pid);
        productsRemoved++;
      }
    }

    // 3. Reopen the idea in the studio.
    await db.from("art_briefs").update({ state: "draft", updated_at: new Date().toISOString() } as never).eq("id", briefId);

    // 4. Durable trail on the brief thread (client-safe wording).
    const who = (user.user_metadata as any)?.name || user.email || "The team";
    await db.from("art_brief_messages").insert({
      brief_id: briefId,
      sender_role: "hpd",
      sender_name: who,
      message: `↩ Back on the bench — ${(job as any).job_number} was reversed so we can rework this before it goes to production.`,
      visibility: "all",
    } as never);

    return NextResponse.json({ ok: true, briefId, productsRemoved });
  } catch (e: any) {
    console.error("[jobs/send-back]", e);
    return NextResponse.json({ error: e?.message || "Send back failed" }, { status: 500 });
  }
}
