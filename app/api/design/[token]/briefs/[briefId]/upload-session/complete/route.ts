import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { setFilePublicReadable, getDriveWebLink } from "@/lib/drive-resumable";
import { notifyTeamServer, logJobActivityServer } from "@/lib/notify-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

async function verifyAccess(token: string, briefId: string) {
  const db = admin();
  const { data: designer } = await db.from("designers").select("id, active, name").eq("portal_token", token).single();
  if (!designer || !designer.active) return null;
  const { data: brief } = await db.from("art_briefs").select("id, title, assigned_designer_id, state, item_id, job_id").eq("id", briefId).single();
  if (!brief || brief.assigned_designer_id !== designer.id) return null;
  return { db, designer, brief };
}

const DESIGNER_KINDS = ["wip", "first_draft", "revision", "final"];

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const ctx = await verifyAccess(params.token, params.briefId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { drive_file_id, file_name, mime_type, file_size, kind, note } = await req.json();
    if (!drive_file_id || !file_name) {
      return NextResponse.json({ error: "drive_file_id, file_name required" }, { status: 400 });
    }
    const k = (kind || "wip").toLowerCase();
    if (!DESIGNER_KINDS.includes(k)) return NextResponse.json({ error: "Invalid kind" }, { status: 400 });

    try { await setFilePublicReadable(drive_file_id); } catch {}
    const webViewLink = await getDriveWebLink(drive_file_id);

    // Version per kind
    const { count } = await ctx.db.from("art_brief_files").select("id", { count: "exact", head: true })
      .eq("brief_id", ctx.brief.id).eq("kind", k);
    const version = (count || 0) + 1;

    const noteTrimmed = (note || "").trim() || null;
    const { data, error } = await ctx.db.from("art_brief_files").insert({
      brief_id: ctx.brief.id,
      file_name,
      drive_file_id,
      drive_link: webViewLink,
      mime_type: mime_type || null,
      file_size: file_size || null,
      kind: k,
      version,
      uploader_role: "designer",
      designer_annotation: noteTrimmed,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto state transition (same mapping as the legacy multipart route)
    const now = new Date().toISOString();
    let newState = (ctx.brief as any).state;
    if (k === "wip") newState = "wip_review";
    if (k === "first_draft") newState = "client_review";
    if (k === "revision") newState = "client_review";
    if (k === "final") newState = "pending_prep";

    await ctx.db.from("art_briefs").update({
      state: newState,
      version_count: version,
      updated_at: now,
    }).eq("id", ctx.brief.id);

    const kindLabel: Record<string, string> = {
      wip: "WIP", first_draft: "1st Draft", revision: "Revision", final: "FINAL",
    };
    const activityMsg = `Designer uploaded ${kindLabel[k] || k.toUpperCase()} v${version} for "${(ctx.brief as any).title || "brief"}"`;

    try {
      await notifyTeamServer(activityMsg, k === "final" ? "approval" : "production", ctx.brief.id, "art_brief");
      if ((ctx.brief as any).job_id) await logJobActivityServer((ctx.brief as any).job_id, activityMsg);
    } catch {}

    return NextResponse.json({ file: data, state: newState });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
