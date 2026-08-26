// THE DESIGNER DOOR — server-only helpers (DB on the service role, Drive, mail).
// An order hangs off a DESIGN (art_brief) or an ITEM (a job's run); every
// helper here resolves the target once and the routes stay thin.
import { dbNoStore } from "@/lib/db-nostore";
import { sendInternalMail } from "@/lib/internal-mail";
import { getDriveToken, getOrCreateNestedFolder, getItemFolderIdForItem } from "@/lib/drive-token";
import type { BriefSpec, DesignWorkOrder, DesignWoMessage } from "@/lib/design-work-orders";

export const woDb = dbNoStore;

// A short, url-safe magic-link token (same shape as the Lab's).
export function newWoToken(len = 22): string {
  const a = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = ""; for (let i = 0; i < len; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

// ── The target: who/what an order is for, resolved once ─────────────────────
export type ResolvedTarget = {
  kind: "brief" | "item"; briefId: string | null; itemId: string | null; jobId: string | null;
  title: string; clientName: string; jobTitle: string | null; jobNumber: string | null; companySlug: string; companyName: string;
};
export async function resolveTarget(t: { briefId?: string | null; itemId?: string | null }): Promise<ResolvedTarget | null> {
  const db = woDb();
  if (t.itemId) {
    const { data: it } = await db.from("items").select("id, name, job_id, jobs:job_id(id, title, job_number, clients:client_id(name, company_id, companies:company_id(slug, name)))").eq("id", t.itemId).maybeSingle();
    if (!it) return null;
    const job: any = (it as any).jobs;
    return { kind: "item", briefId: null, itemId: (it as any).id, jobId: job?.id || (it as any).job_id || null, title: (it as any).name || "Item", clientName: job?.clients?.name || "Client", jobTitle: job?.title || null, jobNumber: job?.job_number || null, companySlug: job?.clients?.companies?.slug || "hpd", companyName: job?.clients?.companies?.name || "House Party Distro" };
  }
  if (t.briefId) {
    const { data: b } = await db.from("art_briefs").select("id, title, clients(name, company_id, companies:company_id(slug, name))").eq("id", t.briefId).maybeSingle();
    if (!b) return null;
    return { kind: "brief", briefId: (b as any).id, itemId: null, jobId: null, title: (b as any).title || "Design", clientName: (b as any).clients?.name || "Client", jobTitle: null, jobNumber: null, companySlug: (b as any).clients?.companies?.slug || "hpd", companyName: (b as any).clients?.companies?.name || "House Party Distro" };
  }
  return null;
}
export const targetOf = (wo: Pick<DesignWorkOrder, "brief_id" | "item_id">) => resolveTarget({ briefId: wo.brief_id, itemId: wo.item_id });

// Every Drive id the target already owns — canvases/extras must come from
// here (the art-request tamper guard). Items share the whole JOB's files.
export async function ownedDriveIds(t: ResolvedTarget): Promise<{ ok: Set<string>; rows: { id: string; driveId: string; previewId: string | null; name: string | null }[] }> {
  const db = woDb(); const ok = new Set<string>(); const rows: any[] = [];
  if (t.kind === "brief") {
    const { data } = await db.from("art_brief_files").select("id, drive_file_id, preview_drive_file_id, file_name").eq("brief_id", t.briefId!);
    for (const f of (data || []) as any[]) { if (f.drive_file_id) { ok.add(f.drive_file_id); rows.push({ id: f.id, driveId: f.drive_file_id, previewId: f.preview_drive_file_id || null, name: f.file_name }); } if (f.preview_drive_file_id) ok.add(f.preview_drive_file_id); }
  } else {
    const { data: items } = await db.from("items").select("id").eq("job_id", t.jobId!);
    const ids = (items || []).map((i: any) => i.id);
    if (ids.length) {
      const { data } = await db.from("item_files").select("id, drive_file_id, file_name").in("item_id", ids).not("drive_file_id", "is", null);
      for (const f of (data || []) as any[]) { ok.add(f.drive_file_id); rows.push({ id: f.id, driveId: f.drive_file_id, previewId: null, name: f.file_name }); }
    }
  }
  return { ok, rows };
}

// The Drive folder deliveries land in: the design's studio folder, or the
// item's own folder (stashed ids, so a rename never splits files).
export async function targetFolderId(t: ResolvedTarget): Promise<string> {
  const token = await getDriveToken();
  if (t.kind === "item") return getItemFolderIdForItem(token, t.itemId!);
  return getOrCreateNestedFolder(token, [t.clientName || "Studio", "Studio", t.title || "Design"]);
}

// ── Loading ─────────────────────────────────────────────────────────────────
export async function loadWorkOrder(id: string): Promise<{ wo: DesignWorkOrder; messages: DesignWoMessage[] } | null> {
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*").eq("id", id).maybeSingle();
  if (!wo) return null;
  await healWorkOrder(wo as any);
  const { data: fresh } = await db.from("design_work_orders").select("*").eq("id", id).maybeSingle();
  return { wo: (fresh || wo) as any, messages: await loadMessages(id) };
}
export async function loadWorkOrderByToken(token: string) {
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*").eq("token", token).maybeSingle();
  if (!wo) return null;
  await healWorkOrder(wo as any);
  const { data: fresh } = await db.from("design_work_orders").select("*").eq("token", token).maybeSingle();
  return { wo: (fresh || wo) as any as DesignWorkOrder, messages: await loadMessages((wo as any).id) };
}
async function loadMessages(woId: string): Promise<DesignWoMessage[]> {
  const db = woDb();
  const { data } = await db.from("design_wo_messages").select("*").eq("work_order_id", woId).order("created_at", { ascending: true });
  const msgs = (data || []) as any[];
  // Decorate files with their Drive ids: brief files, item files, or a loose attachment.
  const bIds = msgs.map(m => m.file_id).filter(Boolean); const iIds = msgs.map(m => m.item_file_id).filter(Boolean);
  const bById: Record<string, any> = {}; const iById: Record<string, any> = {};
  if (bIds.length) { const { data: f } = await db.from("art_brief_files").select("id, drive_file_id, preview_drive_file_id, file_name").in("id", bIds); for (const x of (f || []) as any[]) bById[x.id] = x; }
  if (iIds.length) { const { data: f } = await db.from("item_files").select("id, drive_file_id, file_name, stage").in("id", iIds); for (const x of (f || []) as any[]) iById[x.id] = x; }
  return msgs.map(m => {
    const bf = m.file_id ? bById[m.file_id] : null; const itf = m.item_file_id ? iById[m.item_file_id] : null;
    return { ...m, _drive: bf?.drive_file_id || itf?.drive_file_id || m.drive_file_id || null, _preview: bf?.preview_drive_file_id || null, _stage: itf?.stage || null, file_name: m.file_name || bf?.file_name || itf?.file_name || null };
  });
}

// The image ids a work order's messages may serve (deliveries + our
// references) — joins the brief's own set for the token proxy.
export function driveIdsInMessages(messages: any[]): Set<string> {
  const ids = new Set<string>();
  for (const m of messages) { if (m._drive) ids.add(m._drive); if (m._preview) ids.add(m._preview); }
  return ids;
}

// ── State ───────────────────────────────────────────────────────────────────
// A delivery whose file is gone (deleted from the design or the item — both
// paths null the FK) becomes a plain note, and the state re-derives. Runs on
// every load so a stale "Delivered" can't survive a refresh.
export async function healWorkOrder(wo: { id: string; state: string; accepted_file_id: string | null; accepted_item_file_id: string | null }): Promise<void> {
  const db = woDb();
  const { data: orphans } = await db.from("design_wo_messages").select("id, body").eq("work_order_id", wo.id).eq("kind", "delivery").is("file_id", null).is("item_file_id", null);
  for (const m of (orphans || []) as any[]) await db.from("design_wo_messages").update({ kind: "comment", body: [m.body, "(file removed)"].filter(Boolean).join(" ") } as never).eq("id", m.id);
  if ((orphans || []).length || (wo.state === "accepted" && !wo.accepted_file_id && !wo.accepted_item_file_id)) await recomputeWoState(wo.id);
}
export async function recomputeWoState(woId: string): Promise<string | null> {
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("id, state, accepted_file_id, accepted_item_file_id").eq("id", woId).maybeSingle();
  if (!wo) return null;
  const cur = (wo as any).state as string;
  if (cur === "killed") return cur;
  if (cur === "accepted" && ((wo as any).accepted_file_id || (wo as any).accepted_item_file_id)) return cur;
  const { data: msgs } = await db.from("design_wo_messages").select("sender_role, kind, file_id, item_file_id, created_at").eq("work_order_id", woId).order("created_at", { ascending: true });
  let next = "out";
  for (const m of (msgs || []) as any[]) {
    if (m.sender_role === "designer" && m.kind === "delivery" && (m.file_id || m.item_file_id)) next = "delivered";
    else if (m.sender_role === "hpd" && next === "delivered") next = "in_revision";
  }
  if (next !== cur) await db.from("design_work_orders").update({ state: next, updated_at: new Date().toISOString() } as never).eq("id", woId);
  return next;
}
// A brief file is being deleted (studio route): detach eagerly so the desk is
// right before the next load. Item-file deletes happen client-side and are
// caught by healWorkOrder on load.
export async function detachFileFromWorkOrders(fileId: string): Promise<void> {
  const db = woDb();
  const { data: msgs } = await db.from("design_wo_messages").select("id, work_order_id, body").eq("file_id", fileId);
  const woIds = new Set<string>();
  for (const m of (msgs || []) as any[]) { woIds.add(m.work_order_id); await db.from("design_wo_messages").update({ file_id: null, kind: "comment", body: [m.body, "(file removed)"].filter(Boolean).join(" ") } as never).eq("id", m.id); }
  const { data: accepted } = await db.from("design_work_orders").select("id").eq("accepted_file_id", fileId);
  for (const w of (accepted || []) as any[]) { woIds.add(w.id); await db.from("design_work_orders").update({ accepted_file_id: null } as never).eq("id", w.id); }
  for (const id of Array.from(woIds)) await recomputeWoState(id);
}

// Inbound wall for deliveries: the Drive file must sit in the given folder.
export async function verifyDriveFileInFolder(token: string, fileId: string, folderId: string): Promise<{ mimeType: string | null; size: number | null; name: string | null } | null> {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,parents`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const meta = await res.json().catch(() => null);
  if (!meta || !Array.isArray(meta.parents) || !meta.parents.includes(folderId)) return null;
  return { mimeType: meta.mimeType || null, size: meta.size ? Number(meta.size) : null, name: meta.name || null };
}

// Sanitize an incoming brief spec against what the target owns.
export function sanitizeSpec(raw: any, ok: Set<string>): BriefSpec {
  const spec: BriefSpec = { canvases: [], extras: [], conversation: [] };
  for (const c of (raw?.canvases || []) as any[]) {
    if (!c?.driveId || !ok.has(c.driveId)) continue;
    spec.canvases.push({
      id: String(c.id || Math.random().toString(36).slice(2, 9)), fileId: c.fileId || null, driveId: c.driveId,
      previewId: c.previewId && ok.has(c.previewId) ? c.previewId : null, name: c.name || null, note: c.note ? String(c.note).trim() : null,
      pins: (Array.isArray(c.pins) ? c.pins : []).map((p: any) => ({
        id: String(p.id || Math.random().toString(36).slice(2, 9)),
        x: Math.min(100, Math.max(0, Number(p.x) || 0)), y: Math.min(100, Math.max(0, Number(p.y) || 0)),
        text: String(p.text || "").trim(), driveId: p.driveId || null, name: p.name || null,
      })).filter((p: any) => p.text || p.driveId),
    });
  }
  for (const e of (raw?.extras || []) as any[]) {
    if (!e?.driveId || !ok.has(e.driveId)) continue;
    spec.extras.push({ fileId: e.fileId || null, driveId: e.driveId, previewId: e.previewId && ok.has(e.previewId) ? e.previewId : null, name: e.name || null, label: e.label ? String(e.label).slice(0, 40) : null });
  }
  for (const l of (Array.isArray(raw?.conversation) ? raw.conversation : []) as any[]) {
    const text = String(l?.text || "").trim(); if (!text) continue;
    spec.conversation!.push({ role: l.role === "client" ? "client" : "us", text: text.slice(0, 2000), at: l.at || null });
  }
  return spec;
}

// The production note, written from the item's proof spec (the proof IS the
// brief for seps): garment, print type, ink count, every location with size +
// placement. Editable before send; a fallback line when there's no proof yet.
export async function productionNoteForItem(itemId: string): Promise<string> {
  const db = woDb();
  const { data: it } = await db.from("items").select("name, blank_vendor, blank_sku, garment_type, proof_spec, jobs:job_id(job_number)").eq("id", itemId).maybeSingle();
  if (!it) return "";
  const ps: any = (it as any).proof_spec || null;
  const lines: string[] = [];
  const head = [(it as any).name, (it as any).jobs?.job_number].filter(Boolean).join(" · ");
  if (head) lines.push(head);
  const method = [...(ps?.methods || [])].filter(Boolean).join(" + ");
  const tech = [method, ps?.printType, ps?.colorCount ? `${ps.colorCount} color${ps.colorCount === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ");
  if (tech) lines.push(tech);
  const blank = [(it as any).blank_vendor || ps?.blankVendor, (it as any).blank_sku || ps?.blankColor].filter(Boolean).join(" · ");
  if (blank) lines.push(`Blank: ${blank}`);
  const locs = (ps?.locations || []) as any[];
  if (locs.length) {
    lines.push("");
    for (const l of locs) {
      const names = (l.colors || []).map((c: any) => c?.name).filter((n: any) => n && !/^separations?$/i.test(n));
      const sizeTagLike = names.length && names.every((n: string) => /^\d?x{0,3}[sml]$/i.test(n) || /^\d+xl$/i.test(n));
      lines.push([l.placement, l.sizeText, l.callout, sizeTagLike ? `sizes ${names.join("/")}` : (names.length ? names.join(", ") : null)].filter(Boolean).join(" · "));
    }
  }
  if (ps?.finishing?.length) { lines.push(""); lines.push(`Finishing: ${ps.finishing.join(", ")}`); }
  if (ps?.notes) { lines.push(""); lines.push(String(ps.notes).trim()); }
  if (!locs.length) lines.push("", "No proof on this item yet — add locations, sizes and placement here.");
  lines.push("", "Deliver: separations per location, print-ready, named by location.");
  return lines.join("\n");
}

// Fire the labs@ ping for a designer move. Best-effort, never sinks the write.
export async function pingLabsAboutDesigner(kind: "designer_delivery" | "designer_reply", wo: DesignWorkOrder, note?: string | null) {
  try {
    await sendInternalMail({ kind, title: wo.title || "Design", woType: wo.type, briefId: wo.brief_id || "", woId: wo.id, jobId: wo.job_id || null, designer: wo.designer_name || wo.designer_email || "the designer", note: note || null } as any);
  } catch {}
}
