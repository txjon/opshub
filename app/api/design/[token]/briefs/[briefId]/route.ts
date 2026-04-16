import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, assigned_designer_id").eq("id", briefId).single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

// GET — full brief detail for designer (excludes internal_notes, client raw intake words)
export async function GET(_req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const ctx = await verifyAccess(params.token, params.briefId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: brief } = await ctx.db.from("art_briefs")
    .select("id, title, concept, placement, colors, mood_words, deadline, state, version_count, sent_to_designer_at, clients(name)")
    .eq("id", params.briefId)
    .single();

  const { data: files } = await ctx.db.from("art_brief_files")
    .select("id, file_name, drive_file_id, drive_link, mime_type, file_size, version, kind, hpd_annotation, uploader_role, created_at")
    .eq("brief_id", params.briefId)
    .order("created_at");

  // Messages visible to designer (all + hpd_designer, NOT hpd_only)
  const { data: messages } = await ctx.db.from("art_brief_messages")
    .select("id, sender_role, sender_name, message, created_at")
    .eq("brief_id", params.briefId)
    .in("visibility", ["all", "hpd_designer"])
    .order("created_at");

  return NextResponse.json({ brief, files: files || [], messages: messages || [] });
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
