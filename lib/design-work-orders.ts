// THE DESIGNER DOOR — shared, client-safe model (mig 165). Room 2 on the real
// studio: a work order hangs off an art_brief, hard-walled from the client, and
// carries a PINNED BRIEF. Server-only helpers live in
// lib/design-work-orders-server.ts.
import { H } from "@/lib/studio-theme";

export type WoType = "creative" | "vector" | "separations";
export type WoState = "out" | "delivered" | "in_revision" | "accepted" | "killed";

// A pin: a spot on a canvas + what to do there. x/y are PERCENTAGES of the
// rendered image box so the spec is resolution-independent. driveId = an
// optional swap-in image ("replace the hammer with THIS").
export type BriefPin = { id: string; x: number; y: number; text: string; driveId?: string | null; name?: string | null };
// A canvas: one reference image from the design thread, with its pins.
export type BriefCanvas = { id: string; fileId?: string | null; driveId: string; previewId?: string | null; name?: string | null; note?: string | null; pins: BriefPin[] };
// Loose extra hand-overs (the rest of the thread's images, no pins).
export type BriefExtra = { fileId?: string | null; driveId: string; previewId?: string | null; name?: string | null };
// The conversation, handed over with the wall intact: roles only (client / us),
// never a name. The designer reads what the client actually said.
export type BriefLine = { role: "client" | "us"; text: string; at?: string | null };
export type BriefSpec = { canvases: BriefCanvas[]; extras: BriefExtra[]; conversation?: BriefLine[] };
export const EMPTY_BRIEF: BriefSpec = { canvases: [], extras: [], conversation: [] };

// Where an order hangs: a DESIGN (art_brief — creative) or an ITEM (a job's
// run — vector / separations; the accepted file becomes its print-ready file).
export type WoTarget = { kind: "brief" | "item"; id: string; title: string | null; clientName: string | null; jobId?: string | null; jobTitle?: string | null; jobNumber?: string | null };

export type DesignWorkOrder = {
  id: string; brief_id: string | null; item_id: string | null; job_id: string | null; type: WoType; title: string | null;
  headline: string | null; instructions: string | null; brief: BriefSpec;
  due_by: string | null; designer_name: string | null; designer_email: string | null;
  token: string; state: WoState; accepted_file_id: string | null; accepted_item_file_id: string | null;
  sent_at: string | null; last_designer_at: string | null; last_hpd_at: string | null; hpd_seen_at: string | null;
  created_by: string | null; created_at: string; updated_at: string;
};
export type DesignWoMessage = {
  id: string; work_order_id: string; sender_role: "hpd" | "designer"; sender_name: string | null;
  body: string | null; file_id: string | null; item_file_id: string | null; drive_file_id: string | null; file_url: string | null; file_name: string | null;
  kind: "comment" | "delivery" | "revision" | "accept"; created_at: string;
  // decorated by the API: a renderable image url + a download url
  image_url?: string | null; download_url?: string | null;
};

// What we can ask a designer for. Mockups are NOT here — they're internal.
export const WO_TYPES: { id: WoType; label: string; blurb: string }[] = [
  { id: "creative", label: "Creative art", blurb: "Draw it from the references" },
  { id: "vector", label: "Vector clean-up", blurb: "Clean an existing file" },
  { id: "separations", label: "Separations", blurb: "Split into print colors" },
];
export const woTypeLabel = (t: string) => WO_TYPES.find(x => x.id === t)?.label || t;

// Loose derived state, the studio's vocabulary. Color-text, no pills.
export function woState(wo: Pick<DesignWorkOrder, "state" | "last_designer_at" | "hpd_seen_at" | "due_by">): { label: string; color: string; unread: boolean; late: boolean } {
  const unread = !!wo.last_designer_at && (!wo.hpd_seen_at || wo.last_designer_at > wo.hpd_seen_at);
  const late = !!wo.due_by && !["accepted", "killed"].includes(wo.state) && wo.due_by < new Date().toISOString().slice(0, 10);
  if (wo.state === "accepted") return { label: "Accepted", color: H.green, unread: false, late: false };
  if (wo.state === "killed") return { label: "Killed", color: H.faint, unread: false, late: false };
  if (wo.state === "delivered") return { label: unread ? "Delivered · new" : "Delivered", color: H.blue, unread, late };
  if (wo.state === "in_revision") return { label: "In revision", color: H.amber, unread, late };
  return { label: unread ? "Designer replied" : "With the designer", color: unread ? H.amber : H.dim, unread, late };
}

export const isOpenWo = (s: WoState) => s !== "accepted" && s !== "killed";

// Every Drive id a work order is allowed to serve to its designer — the
// token-scoped file proxy validates against THIS set, never a raw id.
export function driveIdsInBrief(spec: BriefSpec | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const c of spec?.canvases || []) {
    if (c.driveId) ids.add(c.driveId); if (c.previewId) ids.add(c.previewId);
    for (const p of c.pins || []) if (p.driveId) ids.add(p.driveId);
  }
  for (const e of spec?.extras || []) { if (e.driveId) ids.add(e.driveId); if (e.previewId) ids.add(e.previewId); }
  return ids;
}

export function newPinId(): string { return Math.random().toString(36).slice(2, 9); }
