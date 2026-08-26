// THE DESIGNER DOOR — server-only helpers (DB on the service role, Drive, mail).
import { dbNoStore } from "@/lib/db-nostore";
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

// Inbound wall for deliveries: the Drive file must sit in the given folder.
// Returns its meta, or null if it isn't there / doesn't exist.
export async function verifyDriveFileInFolder(token: string, fileId: string, folderId: string): Promise<{ mimeType: string | null; size: number | null; name: string | null } | null> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const meta = await res.json().catch(() => null);
  if (!meta || !Array.isArray(meta.parents) || !meta.parents.includes(folderId)) return null;
  return { mimeType: meta.mimeType || null, size: meta.size ? Number(meta.size) : null, name: meta.name || null };
}

// Fire the labs@ ping for a designer move. Best-effort, never sinks the write.
export async function pingLabsAboutDesigner(kind: "designer_delivery" | "designer_reply", wo: DesignWorkOrder, note?: string | null) {
  try {
    await sendInternalMail({ kind, title: wo.title || "Design", woType: wo.type, briefId: wo.brief_id, woId: wo.id, designer: wo.designer_name || wo.designer_email || "the designer", note: note || null } as any);
  } catch {}
}
