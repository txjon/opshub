// THE DESIGNER DOOR — server-only helpers (DB on the service role, Drive, mail).
import { dbNoStore } from "@/lib/db-nostore";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";
import { generatePsdPreview, isPsdFile } from "@/lib/psd-preview-server";
import { LAB_BUCKET } from "@/lib/lab";
import { sendInternalMail } from "@/lib/internal-mail";
import type { DesignWorkOrder, DesignWoMessage } from "@/lib/design-work-orders";

export const woDb = dbNoStore;

// A short, url-safe magic-link token (same shape as the Lab's).
export function newWoToken(len = 22): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export async function loadWorkOrder(id: string): Promise<{ wo: DesignWorkOrder; messages: DesignWoMessage[] } | null> {
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*").eq("id", id).maybeSingle();
  if (!wo) return null;
  return { wo: wo as any, messages: await loadMessages(id) };
}
export async function loadWorkOrderByToken(token: string) {
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*").eq("token", token).maybeSingle();
  if (!wo) return null;
  return { wo: wo as any as DesignWorkOrder, messages: await loadMessages((wo as any).id) };
}
async function loadMessages(woId: string): Promise<DesignWoMessage[]> {
  const db = woDb();
  const { data } = await db.from("design_wo_messages").select("*").eq("work_order_id", woId).order("created_at", { ascending: true });
  const msgs = (data || []) as any[];
  // Decorate files: the art_brief_files row gives us the Drive ids.
  const fileIds = msgs.map(m => m.file_id).filter(Boolean);
  const byId: Record<string, any> = {};
  if (fileIds.length) {
    const { data: files } = await db.from("art_brief_files").select("id, drive_file_id, preview_drive_file_id, file_name").in("id", fileIds);
    for (const f of (files || []) as any[]) byId[f.id] = f;
  }
  return msgs.map(m => {
    const f = m.file_id ? byId[m.file_id] : null;
    return { ...m, _drive: f?.drive_file_id || null, _preview: f?.preview_drive_file_id || null, file_name: m.file_name || f?.file_name || null };
  });
}

// The image ids a work order's messages may serve (deliveries + our reference
// replies) — joins the brief's own set for the token proxy.
export function driveIdsInMessages(messages: any[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) { if (m._drive) ids.add(m._drive); if (m._preview) ids.add(m._preview); }
  return ids;
}

// A designer's delivery: the bytes landed in storage (signed upload); copy
// them into Drive under the design's folder + register a REAL brief file
// (uploader_role designer, internal until we share). If Drive is down the
// storage url still rides the message — nothing is ever lost.
export async function fileDesignerDelivery(opts: { briefId: string; clientName: string; designTitle: string; storagePath: string; fileName: string; mimeType: string }): Promise<{ fileRowId: string | null; publicUrl: string }> {
  const db = woDb();
  const { data: pub } = db.storage.from(LAB_BUCKET).getPublicUrl(opts.storagePath);
  const publicUrl = pub.publicUrl;
  try {
    const dl = await db.storage.from(LAB_BUCKET).download(opts.storagePath);
    if (dl.error || !dl.data) throw new Error(dl.error?.message || "download failed");
    const buffer = Buffer.from(await dl.data.arrayBuffer());
    const folderId = await getItemFolderId(opts.clientName || "Studio", "Studio", opts.designTitle || "Design");
    const up = await uploadFile(folderId, opts.fileName, opts.mimeType || "application/octet-stream", buffer);
    const { data: fRow, error } = await db.from("art_brief_files").insert({
      brief_id: opts.briefId, file_name: opts.fileName, drive_file_id: up.fileId, drive_link: up.webViewLink,
      mime_type: opts.mimeType || null, file_size: buffer.length, kind: "wip", uploader_role: "designer",
      shared_with_client_at: null,
    } as never).select("id").single();
    if (error || !fRow) throw new Error(error?.message || "register failed");
    if (isPsdFile(opts.fileName, opts.mimeType)) {
      generatePsdPreview(up.fileId, opts.fileName).then(async (previewId) => {
        if (previewId) await db.from("art_brief_files").update({ preview_drive_file_id: previewId } as never).eq("id", (fRow as any).id);
      }).catch(() => {});
    }
    return { fileRowId: (fRow as any).id, publicUrl };
  } catch (e) {
    console.error("[designer-door] Drive copy failed, keeping storage copy", (e as any)?.message || e);
    return { fileRowId: null, publicUrl };
  }
}

// Fire the labs@ ping for a designer move. Best-effort, never sinks the write.
export async function pingLabsAboutDesigner(kind: "designer_delivery" | "designer_reply", wo: DesignWorkOrder, note?: string | null) {
  try {
    await sendInternalMail({ kind, title: wo.title || "Design", woType: wo.type, briefId: wo.brief_id, woId: wo.id, designer: wo.designer_name || wo.designer_email || "the designer", note: note || null } as any);
  } catch {}
}
