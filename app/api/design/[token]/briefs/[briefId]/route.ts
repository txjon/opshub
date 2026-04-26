import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { computeFileOrdinals } from "@/lib/art-activity-text";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active, name").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, title, state, assigned_designer_id, job_id").eq("id", briefId).single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

// GET — full brief detail for designer (excludes internal_notes, client raw intake words)
export async function GET(_req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // First-open read receipt — when the designer opens a brief still in
  // `sent`, auto-advance to `in_progress` so HPD knows it landed and was
  // viewed. Fire-and-forget so we don't block the GET.
  if (ctx.brief.state === "sent") {
    const designerName = (ctx.designer as any).name || "Designer";
    const briefTitle = (ctx.brief as any).title || "brief";
    ctx.db.from("art_briefs")
      .update({ state: "in_progress", updated_at: new Date().toISOString() })
      .eq("id", ctx.brief.id)
      .then(() => {});
    try {
      await notifyTeamServer(`${designerName} opened "${briefTitle}"`, "production", ctx.brief.id, "art_brief");
      if ((ctx.brief as any).job_id) {
        await logJobActivityServer((ctx.brief as any).job_id, `${designerName} opened ${briefTitle}`);
      }
    } catch {}
  }

  // Mark-as-read for designer on every detail open. Listing rollup
  // factors this into designerAt so unread ribbons clear once the
  // brief has been viewed.
  ctx.db.from("art_briefs")
    .update({ designer_last_seen_at: new Date().toISOString() })
    .eq("id", ctx.brief.id)
    .then(() => {});

  const { data: brief } = await ctx.db.from("art_briefs")
    .select("id, title, concept, placement, colors, mood_words, deadline, state, version_count, sent_to_designer_at, client_aborted_at, archived_by, clients(name)")
    .eq("id", params.briefId)
    .single();

  const { data: filesRaw } = await ctx.db.from("art_brief_files")
    .select("id, file_name, drive_file_id, drive_link, mime_type, file_size, version, kind, hpd_annotation, client_annotation, designer_annotation, shared_with_client_at, uploader_role, created_at")
    .eq("brief_id", params.briefId)
    .order("created_at");

  // Designer doesn't see HPD's print_ready (CMYK separations, internal prep).
  const files = (filesRaw || []).filter((f: any) => f.kind !== "print_ready");

  const fileIds = (files || []).map((f: any) => f.id);
  const { data: commentsRaw } = fileIds.length > 0
    ? await ctx.db.from("art_brief_file_comments")
        .select("id, file_id, sender_role, body, created_at")
        .in("file_id", fileIds)
        .order("created_at")
    : { data: [] as any[] };
  const commentsByFile: Record<string, any[]> = {};
  for (const c of (commentsRaw || [])) (commentsByFile[c.file_id] ||= []).push(c);

  // Per-kind 1-based ordinal so the file badge can render "REF 3" /
  // "2nd Draft" instead of just "REF" / "REV".
  const ordinals = computeFileOrdinals(files || []);
  const filesWithOrd = (files || []).map((f: any) => ({
    ...f,
    kind_ordinal: ordinals[f.id] || null,
    comments: commentsByFile[f.id] || [],
  }));

  // Messages visible to designer (all + hpd_designer, NOT hpd_only)
  const { data: messages } = await ctx.db.from("art_brief_messages")
    .select("id, sender_role, sender_name, message, created_at")
    .eq("brief_id", params.briefId)
    .in("visibility", ["all", "hpd_designer"])
    .order("created_at");

  return NextResponse.json({ brief, files: filesWithOrd, messages: messages || [] });
}

// PATCH — designer updates state (manual transitions like "mark final uploaded")
export async function PATCH(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { state } = await req.json();
  const allowed = ["in_progress", "wip_review", "final_approved", "revisions"];
  if (!allowed.includes(state)) return NextResponse.json({ error: "Invalid state transition" }, { status: 400 });

  const { error } = await ctx.db.from("art_briefs").update({ state, updated_at: new Date().toISOString() }).eq("id", params.briefId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
