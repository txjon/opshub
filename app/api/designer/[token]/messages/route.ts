import { NextRequest, NextResponse } from "next/server";
import { woDb, pingLabsAboutDesigner, verifyDriveFileInFolder, targetOf, targetFolderId } from "@/lib/design-work-orders-server";
import { getDriveToken } from "@/lib/drive-token";
import { setFilePublicReadable, getDriveWebLink } from "@/lib/drive-resumable";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The designer's send: { body?, driveFileId?, fileName?, mimeType?, fileSize?,
// senderName? }. A file (already streamed into Drive via upload-session +
// upload-chunk) = a DELIVERY: verified to sit in THIS target's folder, then
// registered as a REAL file — on a design: art_brief_files (designer, internal);
// on a run: item_files at stage 'vector' (Accept flips it to print_ready).
// Words alone = a reply. labs@ gets the ping either way.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const b = await req.json().catch(() => ({} as any));
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*").eq("token", params.token).maybeSingle();
  if (!wo || (wo as any).state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  if ((wo as any).state === "accepted") return NextResponse.json({ error: "This order is closed — the file was accepted" }, { status: 409 });
  const body = b.body ? String(b.body).trim() : "";
  const driveFileId = b.driveFileId ? String(b.driveFileId).trim() : "";
  if (!body && !driveFileId) return NextResponse.json({ error: "Say something or attach the file" }, { status: 400 });

  const senderName = (b.senderName && String(b.senderName).trim()) || (wo as any).designer_name || "Designer";
  const fileName = String(b.fileName || "delivery").slice(0, 200);
  let fileRowId: string | null = null, itemFileId: string | null = null;
  if (driveFileId) {
    const t = await targetOf(wo as any);
    if (!t) return NextResponse.json({ error: "This order's target is gone" }, { status: 404 });
    // The wall, inbound: only a file that landed in THIS target's folder.
    const token = await getDriveToken();
    const folderId = await targetFolderId(t);
    const meta = await verifyDriveFileInFolder(token, driveFileId, folderId);
    if (!meta) return NextResponse.json({ error: "That file isn't in this order's folder" }, { status: 403 });
    setFilePublicReadable(driveFileId).catch(() => {});
    const link = (await getDriveWebLink(driveFileId).catch(() => null)) || `https://drive.google.com/file/d/${driveFileId}/view`;
    const mime = b.mimeType || meta.mimeType || null;
    const size = Number.isFinite(Number(b.fileSize)) ? Number(b.fileSize) : (meta.size ?? null);
    if (t.kind === "brief") {
      const { data: fRow, error } = await db.from("art_brief_files").insert({ brief_id: t.briefId, file_name: fileName, drive_file_id: driveFileId, drive_link: link, mime_type: mime, file_size: size, kind: "wip", uploader_role: "designer", shared_with_client_at: null } as never).select("id").single();
      if (error || !fRow) return NextResponse.json({ error: error?.message || "Couldn't file the delivery" }, { status: 500 });
      fileRowId = (fRow as any).id;
      if (isPsdFile(fileName, mime)) generatePsdPreview(driveFileId, fileName).then(async (previewId) => { if (previewId) await db.from("art_brief_files").update({ preview_drive_file_id: previewId } as never).eq("id", fileRowId!); }).catch(() => {});
    } else {
      const { data: fRow, error } = await db.from("item_files").insert({ item_id: t.itemId, file_name: fileName, stage: "vector", drive_file_id: driveFileId, drive_link: link, mime_type: mime, file_size: size, approval: "none", notes: `Designer delivery — ${senderName}` } as never).select("id").single();
      if (error || !fRow) return NextResponse.json({ error: error?.message || "Couldn't file the delivery" }, { status: 500 });
      itemFileId = (fRow as any).id;
    }
  }
  const isDelivery = !!driveFileId;
  const { data: msg, error } = await db.from("design_wo_messages").insert({
    work_order_id: (wo as any).id, sender_role: "designer", sender_name: senderName, body: body || null,
    file_id: fileRowId, item_file_id: itemFileId, file_name: isDelivery ? fileName : null, kind: isDelivery ? "delivery" : "comment",
  } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const now = new Date().toISOString();
  await db.from("design_work_orders").update({
    ...(isDelivery ? { state: "delivered" } : {}), last_designer_at: now, updated_at: now,
    ...(b.senderName && !(wo as any).designer_name ? { designer_name: senderName } : {}),
  } as never).eq("id", (wo as any).id);
  if ((wo as any).brief_id) await db.from("art_briefs").update({ updated_at: now } as never).eq("id", (wo as any).brief_id);
  await pingLabsAboutDesigner(isDelivery ? "designer_delivery" : "designer_reply", { ...(wo as any), designer_name: senderName }, body || null);
  return NextResponse.json({ message: msg, state: isDelivery ? "delivered" : (wo as any).state });
}
