import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The studio composer, email-style (the Lab's proven shape): ONE send —
// multipart form with optional `file`, optional `body`, and `visibility`
// (client | internal). A client-visible send hands the ball to the client
// (state → with_client); internal notes never move it; an approved brief is
// never disturbed. Files land in Drive + art_brief_files (kind 'wip',
// shared_with_client_at stamped when client-visible).
const admin = dbNoStore;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const senderName = (profile as any)?.full_name || user.email || "HPD";

  const db = admin();
  const { data: brief } = await db.from("art_briefs").select("id, title, state, clients(name)").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const form = await req.formData();
  const body = String(form.get("body") || "").trim();
  const visibility = form.get("visibility") === "internal" ? "internal" : "client";
  const file = form.get("file") as File | null;
  if (!body && !file) return NextResponse.json({ error: "Say something or attach a file" }, { status: 400 });

  if (file && file.size > 0) {
    const folderId = await getItemFolderId((brief as any).clients?.name || "Studio", "Studio", (brief as any).title || "Design");
    const buffer = Buffer.from(await file.arrayBuffer());
    const up = await uploadFile(folderId, file.name || "design.png", file.type || "image/png", buffer);
    const { data: fRow, error: fErr } = await db.from("art_brief_files").insert({
      brief_id: params.id,
      file_name: file.name || "design.png",
      drive_file_id: up.fileId,
      drive_link: up.webViewLink,
      mime_type: file.type || null,
      file_size: buffer.length,
      kind: "wip",
      uploader_role: "hpd",
      shared_with_client_at: visibility === "client" ? new Date().toISOString() : null,
    }).select("id").single();
    if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });
    // PSDs can't thumbnail raw — render a PNG preview into Drive (proof-flow
    // machinery), fire-and-forget; the row picks up preview_drive_file_id.
    if (fRow && isPsdFile(file.name, file.type)) {
      generatePsdPreview(up.fileId, file.name || "design.psd").then(async (previewId) => {
        if (previewId) await db.from("art_brief_files").update({ preview_drive_file_id: previewId } as never).eq("id", (fRow as any).id);
      }).catch(() => {});
    }
  }
  if (body) {
    const { error: mErr } = await db.from("art_brief_messages").insert({
      brief_id: params.id, sender_role: "hpd", sender_name: senderName,
      message: body, visibility,
    });
    if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  }

  // Ping-pong turn: a client-visible send hands them the ball.
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ((brief as any).state !== "approved" && visibility === "client") patch.state = "with_client";
  await db.from("art_briefs").update(patch).eq("id", params.id);

  return NextResponse.json({ ok: true });
}
