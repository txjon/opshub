import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { woDb } from "@/lib/design-work-orders-server";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Our reply into a work-order thread: { body?, fileId?, webViewLink?, fileName?,
// mimeType?, fileSize? }. A file was uploaded browser → Drive (the studio's
// path) and registers as a REAL brief file (internal). Our word on a delivery
// = a revision ask (state → in_revision). Never disturbs an accepted order.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const name = (profile as any)?.full_name || user.email || "HPD";
  const b = await req.json().catch(() => ({} as any));
  const body = b.body ? String(b.body).trim() : "";
  const driveId = b.fileId ? String(b.fileId).trim() : "";
  if (!body && !driveId) return NextResponse.json({ error: "Say something or attach a file" }, { status: 400 });

  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("id, brief_id, state").eq("id", params.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let fileRowId: string | null = null;
  if (driveId) {
    const fileName = String(b.fileName || "reference.png");
    const { data: fRow, error } = await db.from("art_brief_files").insert({
      brief_id: (wo as any).brief_id, file_name: fileName, drive_file_id: driveId,
      drive_link: b.webViewLink || `https://drive.google.com/file/d/${driveId}/view`,
      mime_type: b.mimeType || null, file_size: Number.isFinite(Number(b.fileSize)) ? Number(b.fileSize) : null,
      kind: "reference", uploader_role: "hpd", shared_with_client_at: null,
    } as never).select("id").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    fileRowId = (fRow as any).id;
    if (isPsdFile(fileName, b.mimeType || null)) {
      generatePsdPreview(driveId, fileName).then(async (previewId) => {
        if (previewId) await db.from("art_brief_files").update({ preview_drive_file_id: previewId } as never).eq("id", fileRowId!);
      }).catch(() => {});
    }
  }
  const cur = (wo as any).state;
  const kind = cur === "delivered" ? "revision" : "comment";
  const { data: msg, error: mErr } = await db.from("design_wo_messages").insert({
    work_order_id: params.id, sender_role: "hpd", sender_name: name, body: body || null,
    file_id: fileRowId, file_name: driveId ? (b.fileName || null) : null, kind,
  } as never).select("*").single();
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 });
  const now = new Date().toISOString();
  const next = cur === "delivered" ? "in_revision" : null;
  await db.from("design_work_orders").update({ ...(next ? { state: next } : {}), last_hpd_at: now, hpd_seen_at: now, updated_at: now } as never).eq("id", params.id);
  return NextResponse.json({ message: msg, state: next || cur });
}
