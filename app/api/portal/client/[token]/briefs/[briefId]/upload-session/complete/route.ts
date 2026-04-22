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
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", token).single();
  if (!client) return null;
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, client_id, job_id")
    .eq("id", briefId)
    .single();
  if (!brief || brief.client_id !== client.id) return null;
  return { db, client, brief };
}

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  try {
    const ctx = await verifyAccess(params.token, params.briefId);
    if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const { drive_file_id, file_name, mime_type, file_size, note } = await req.json();
    if (!drive_file_id || !file_name) {
      return NextResponse.json({ error: "drive_file_id, file_name required" }, { status: 400 });
    }

    try { await setFilePublicReadable(drive_file_id); } catch {}
    const webViewLink = await getDriveWebLink(drive_file_id);

    const noteTrimmed = (note || "").trim() || null;
    const { data, error } = await ctx.db.from("art_brief_files").insert({
      brief_id: ctx.brief.id,
      file_name,
      drive_file_id,
      drive_link: webViewLink,
      mime_type: mime_type || null,
      file_size: file_size || null,
      kind: "reference",
      version: 1,
      uploader_role: "client",
      client_annotation: noteTrimmed,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    try {
      await notifyTeamServer(
        `Client added reference to "${(ctx.brief as any).title || 'brief'}"`,
        "mention", ctx.brief.id, "art_brief"
      );
      if ((ctx.brief as any).job_id) {
        await logJobActivityServer((ctx.brief as any).job_id, `Client uploaded reference on ${(ctx.brief as any).title || "brief"}`);
      }
    } catch {}

    return NextResponse.json({ file: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
