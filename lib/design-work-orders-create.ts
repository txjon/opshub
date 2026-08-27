// Creating a work order — ONE path for both targets (design or item): sanitize
// the pinned brief against what the target owns, mint the token, seed the
// thread, email the designer (from/reply-to the creative desk, never the
// client's name), leave the internal record. Routes stay thin.
import { renderBrandedEmail } from "@/lib/email-template";
import { resendForSlug } from "@/lib/resend-client";
import { appBaseUrlForSlug } from "@/lib/public-url";
import { logJobActivityServer } from "@/lib/notify-server";
import { woDb, newWoToken, ownedDriveIds, sanitizeSpec, type ResolvedTarget } from "@/lib/design-work-orders-server";

export type CreateWoInput = { type: string; headline?: string | null; instructions?: string | null; brief?: any; dueBy?: string | null; designerName?: string | null; designerEmail?: string | null };

export async function createWorkOrder(t: ResolvedTarget, b: CreateWoInput, who: { name: string }, origin: string): Promise<{ workOrder: any; url: string; emailSent: boolean; emailSkipped: string | null } | { error: string; status: number }> {
  if (!["creative", "vector", "separations"].includes(b.type)) return { error: "Pick what you need made", status: 400 };
  const db = woDb();
  const { ok } = await ownedDriveIds(t);
  const spec = sanitizeSpec(b.brief, ok);
  if (!spec.canvases.length && !spec.extras.length) return { error: "Hand over at least one image", status: 400 };
  const designerEmail = b.designerEmail ? String(b.designerEmail).trim().toLowerCase() : null;
  if (designerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(designerEmail)) return { error: "That email doesn't look right", status: 400 };

  const token = newWoToken(); const now = new Date().toISOString();
  const { data: wo, error } = await db.from("design_work_orders").insert({
    brief_id: t.briefId, item_id: t.itemId, job_id: t.jobId, type: b.type, title: t.title,
    headline: b.headline ? String(b.headline).trim().slice(0, 140) : null,
    instructions: b.instructions ? String(b.instructions).trim() : null,
    brief: spec, due_by: b.dueBy || null,
    designer_name: b.designerName ? String(b.designerName).trim() : null, designer_email: designerEmail,
    token, created_by: who.name, last_hpd_at: now,
  } as never).select("*").single();
  if (error || !wo) return { error: error?.message || "Failed", status: 500 };

  // No seed message: the headline + notes render in the brief itself (a copy
  // in the thread just read as redundant — Jon, Aug 26). The thread is for talk.

  // The link is ALWAYS the tenant's real domain (the DB is shared, so a prod
  // link is the only one that works for an outsider). A dev box never emails
  // anyone — Aug 26: a localhost send reached a real designer with a dead link.
  const url = `${appBaseUrlForSlug(t.companySlug)}/designer/${token}`;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  let emailSent = false, emailSkipped: string | null = null;
  if (designerEmail && isLocal) emailSkipped = "localhost";
  else if (designerEmail) {
    emailSent = await sendWorkOrderEmail(t, { ...(wo as any), designer_email: designerEmail, designer_name: b.designerName || null, due_by: b.dueBy || null, headline: b.headline || null }, url);
    if (emailSent) await db.from("design_work_orders").update({ sent_at: now } as never).eq("id", (wo as any).id);
  }
  const record = `Handed to a designer (${b.type})${b.designerName || designerEmail ? ` — ${b.designerName || designerEmail}` : ""}${b.dueBy ? `, due ${b.dueBy}` : ""}.`;
  if (t.kind === "brief") {
    await db.from("art_brief_messages").insert({ brief_id: t.briefId, sender_role: "hpd", sender_name: who.name, message: record, visibility: "internal" } as never);
    await db.from("art_briefs").update({ updated_at: now } as never).eq("id", t.briefId!);
  } else if (t.jobId) {
    await logJobActivityServer(t.jobId, `${t.title}: ${record}`, { work_order_id: (wo as any).id, type: b.type });
  }
  return { workOrder: { ...(wo as any), sent_at: emailSent ? now : null }, url, emailSent, emailSkipped };
}

// The designer's email — used at create and by "Resend link". From/reply-to
// the creative desk; names the client, the item/design and (for runs) the job
// number. Returns true when Resend accepted it.
export async function sendWorkOrderEmail(t: ResolvedTarget, wo: { type: string; designer_email: string | null; designer_name: string | null; due_by: string | null; headline: string | null }, url: string): Promise<boolean> {
  if (!wo.designer_email) return false;
  try {
    const creative = process.env.EMAIL_FROM_CREATIVE || "creative@housepartydistro.com";
    const from = `${t.companyName} <${creative}>`;
    const typeWord = wo.type === "creative" ? "creative art" : wo.type === "vector" ? "a vector clean-up" : "separations";
    const what = `${t.clientName ? `${t.clientName} · ` : ""}${t.title}${t.kind === "item" && t.jobNumber ? ` (${t.jobNumber})` : ""}`;
    const html = renderBrandedEmail({
      eyebrow: t.companyName, heading: "Work order",
      greeting: wo.designer_name ? `Hi ${String(wo.designer_name).trim()},` : "Hi,",
      bodyHtml: `<p style="margin:0 0 14px;">We need ${typeWord} on <strong>${esc(what)}</strong>${wo.due_by ? `, due <strong>${esc(String(wo.due_by))}</strong>` : ""}.</p>` +
        (wo.headline ? `<p style="margin:0 0 14px;"><strong>${esc(String(wo.headline).trim())}</strong></p>` : "") +
        `<p style="margin:0 0 14px;">The brief is pinned right on the reference images at the link below, with every file to download. Deliver your file on that same page, no account needed. Questions go there too.</p>`,
      cta: { label: "Open the work order", url, style: "dark" },
      hint: "This link is yours for this job only. It stays live until the file is accepted.",
    });
    await resendForSlug(t.companySlug).emails.send({ from, to: wo.designer_email, replyTo: creative, subject: `Work order — ${what}`, html });
    return true;
  } catch (e) { console.error("[designer-door] email failed", (e as any)?.message || e); return false; }
}

function esc(s: string): string { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
