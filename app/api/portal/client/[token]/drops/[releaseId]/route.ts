import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH → rename / retarget / submit (building→ready, gate: every slot's
//         idea approved + at least one slot). Submit emails production@.
// DELETE → remove a still-building drop.

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}
const APPROVED = ["approved"];

async function owned(token: string, releaseId: string) {
  const db = admin();
  const { data: client } = await db.from("clients")
    .select("id, name, portal_features").eq("portal_token", token).single();
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("studio")) return null;
  const { data: release } = await db.from("releases").select("*").eq("id", releaseId).single();
  if (!release || (release as any).client_id !== client.id) return null;
  return { db, client, release };
}

export async function PATCH(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const { db, client, release } = ctx;
    const body = await req.json().catch(() => ({}));
    const updates: Record<string, any> = {};

    if (typeof body.title === "string" && body.title.trim()) updates.title = body.title.trim().slice(0, 120);
    if (body.target_live_date !== undefined) {
      updates.target_live_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.target_live_date || "")) ? body.target_live_date : null;
    }
    if (["preorder", "stock"].includes(body.model)) updates.model = body.model;

    if (body.submit === true) {
      if ((release as any).status !== "building") return NextResponse.json({ error: "Already submitted" }, { status: 409 });
      const { data: slots } = await db.from("release_slots")
        .select("id, item_id, art_briefs(state)").eq("release_id", (release as any).id);
      if (!(slots || []).length) return NextResponse.json({ error: "Add at least one item first" }, { status: 400 });
      (release as any)._newLines = (slots || []).filter((s: any) => !s.item_id).length;
      (release as any)._pipeLines = (slots || []).filter((s: any) => !!s.item_id).length;
      const unready = (slots || []).filter((s: any) => !s.item_id && !APPROVED.includes(s.art_briefs?.state)).length;
      if (unready > 0) return NextResponse.json({ error: `${unready} line${unready === 1 ? "" : "s"} still need${unready === 1 ? "s" : ""} an approved design first` }, { status: 400 });
      updates.status = "ready";
      updates.status_timestamps = { ...((release as any).status_timestamps || {}), ready: new Date().toISOString() };
    }

    if (!Object.keys(updates).length) return NextResponse.json({ success: true, unchanged: true });
    updates.updated_at = new Date().toISOString();
    const { error } = await db.from("releases").update(updates).eq("id", (release as any).id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    if (updates.status === "ready") {
      try {
        const { sendInternalMail } = await import("@/lib/internal-mail");
        await sendInternalMail({
          kind: "drop_ready",
          client: (client as any).name,
          title: updates.title || (release as any).title,
          targetLive: (release as any).target_live_date || null,
          newLines: (release as any)._newLines || 0,
          pipeLines: (release as any)._pipeLines || 0,
        });
      } catch {}
    }
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  try {
    const ctx = await owned(params.token, params.releaseId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if ((ctx.release as any).status !== "building") return NextResponse.json({ error: "Only building drops can be removed" }, { status: 409 });
    await ctx.db.from("releases").delete().eq("id", (ctx.release as any).id);
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}
