import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Register a composer attachment that was uploaded browser → Drive directly
// (lib/drive-upload-client — the Product Builder path). Working files are
// big (PSDs 50MB+); pushing the bytes through this server hit platform
// request-body/duration walls and died silently. The bytes never touch this
// route: it writes the art_brief_files row, kicks the PSD preview, and moves
// the ball exactly like the multipart branch of ../messages.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });

  const db = dbNoStore();
  const { data: brief } = await db.from("art_briefs").select("id, state").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const b = await req.json().catch(() => ({} as any));
  const fileId = String(b.fileId || "").trim();
  if (!fileId) return NextResponse.json({ error: "Missing fileId" }, { status: 400 });
  const fileName = String(b.fileName || "design.png");
  const visibility = b.visibility === "internal" ? "internal" : "client";

  const { data: fRow, error: fErr } = await db.from("art_brief_files").insert({
    brief_id: params.id,
    file_name: fileName,
    drive_file_id: fileId,
    drive_link: b.webViewLink || `https://drive.google.com/file/d/${fileId}/view`,
    mime_type: b.mimeType || null,
    file_size: Number.isFinite(Number(b.fileSize)) ? Number(b.fileSize) : null,
    kind: "wip",
    uploader_role: "hpd",
    shared_with_client_at: visibility === "client" ? new Date().toISOString() : null,
  } as never).select("id").single();
  if (fErr) return NextResponse.json({ error: fErr.message }, { status: 500 });

  // PSDs can't thumbnail raw — render a PNG preview into Drive (proof-flow
  // machinery), fire-and-forget; the row picks up preview_drive_file_id.
  if (fRow && isPsdFile(fileName, b.mimeType || null)) {
    generatePsdPreview(fileId, fileName).then(async (previewId) => {
      if (previewId) await db.from("art_brief_files").update({ preview_drive_file_id: previewId } as never).eq("id", (fRow as any).id);
    }).catch(() => {});
  }

  // Ping-pong turn: a client-visible send hands them the ball.
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };
  if ((brief as any).state !== "approved" && visibility === "client") patch.state = "with_client";
  await db.from("art_briefs").update(patch as never).eq("id", params.id);

  return NextResponse.json({ ok: true, fileRowId: (fRow as any).id });
}
