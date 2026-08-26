import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { renderBrandedEmail } from "@/lib/email-template";
import { resendForSlug } from "@/lib/resend-client";
import { appBaseUrlForSlug } from "@/lib/public-url";
import { woDb, newWoToken } from "@/lib/design-work-orders-server";
import type { BriefSpec } from "@/lib/design-work-orders";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE DESIGNER DOOR on one design (mig 165).
// GET  → the design's work orders (newest first).
// POST → hand it to a designer: { type, headline?, instructions?, brief (the
//        pinned spec), dueBy?, designerName?, designerEmail? }. Mints the
//        token, seeds the thread, emails the link when there's an address.
//        The client's name never rides along.
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data } = await woDb().from("design_work_orders").select("*").eq("brief_id", params.id).order("created_at", { ascending: false });
  return NextResponse.json({ workOrders: data || [] });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  if (!["creative", "vector", "separations"].includes(b.type)) return NextResponse.json({ error: "Pick what you need made" }, { status: 400 });
  const db = woDb();
  const { data: brief } = await db.from("art_briefs").select("id, title, clients(name, company_id, companies:company_id(slug, name))").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Design not found" }, { status: 404 });

  // Only this design's files may be canvases/extras — never trust ids blindly
  // (the art-request guard). Pin swap-images are fresh staff uploads (Drive
  // ids from the authed browser→Drive path) and pass through as given.
  const { data: files } = await db.from("art_brief_files").select("id, drive_file_id, preview_drive_file_id, file_name").eq("brief_id", params.id);
  const okDrive = new Set<string>();
  for (const f of (files || []) as any[]) { if (f.drive_file_id) okDrive.add(f.drive_file_id); if (f.preview_drive_file_id) okDrive.add(f.preview_drive_file_id); }
  const spec: BriefSpec = { canvases: [], extras: [], conversation: [] };
  // The thread, roles only — a name never rides along (the wall).
  for (const l of (Array.isArray(b.brief?.conversation) ? b.brief.conversation : []) as any[]) {
    const text = String(l?.text || "").trim(); if (!text) continue;
    spec.conversation!.push({ role: l.role === "client" ? "client" : "us", text: text.slice(0, 2000), at: l.at || null });
  }
  for (const c of (b.brief?.canvases || []) as any[]) {
    if (!c?.driveId || !okDrive.has(c.driveId)) continue;
    spec.canvases.push({
      id: String(c.id || Math.random().toString(36).slice(2, 9)), fileId: c.fileId || null, driveId: c.driveId,
      previewId: c.previewId && okDrive.has(c.previewId) ? c.previewId : null, name: c.name || null, note: c.note ? String(c.note).trim() : null,
      pins: (Array.isArray(c.pins) ? c.pins : []).map((p: any) => ({
        id: String(p.id || Math.random().toString(36).slice(2, 9)),
        x: Math.min(100, Math.max(0, Number(p.x) || 0)), y: Math.min(100, Math.max(0, Number(p.y) || 0)),
        text: String(p.text || "").trim(), driveId: p.driveId || null, name: p.name || null,
      })).filter((p: any) => p.text || p.driveId),
    });
  }
  for (const e of (b.brief?.extras || []) as any[]) {
    if (!e?.driveId || !okDrive.has(e.driveId)) continue;
    spec.extras.push({ fileId: e.fileId || null, driveId: e.driveId, previewId: e.previewId && okDrive.has(e.previewId) ? e.previewId : null, name: e.name || null });
  }
  if (!spec.canvases.length && !spec.extras.length) return NextResponse.json({ error: "Hand over at least one image" }, { status: 400 });

  const designerEmail = b.designerEmail ? String(b.designerEmail).trim().toLowerCase() : null;
  if (designerEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(designerEmail)) return NextResponse.json({ error: "That email doesn't look right" }, { status: 400 });
  const token = newWoToken();
  const now = new Date().toISOString();
  const { data: wo, error } = await db.from("design_work_orders").insert({
    brief_id: params.id, type: b.type, title: (brief as any).title || null,
    headline: b.headline ? String(b.headline).trim().slice(0, 140) : null,
    instructions: b.instructions ? String(b.instructions).trim() : null,
    brief: spec, due_by: b.dueBy || null,
    designer_name: b.designerName ? String(b.designerName).trim() : null, designer_email: designerEmail,
    token, created_by: who.name, last_hpd_at: now,
  } as never).select("*").single();
  if (error || !wo) return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });

  // Seed the thread with the words (the pinned brief itself renders above it).
  const seed = [b.headline, b.instructions].map((x: any) => (x ? String(x).trim() : "")).filter(Boolean).join("\n\n") || "Brief's above — pins on the reference. Deliver the file here when it's ready.";
  await db.from("design_wo_messages").insert({ work_order_id: (wo as any).id, sender_role: "hpd", sender_name: who.name, body: seed, kind: "comment" } as never);

  // The link + email. Tenant slug picks the branding + resend key.
  const slug = (brief as any).clients?.companies?.slug || "hpd";
  const tenantName = (brief as any).clients?.companies?.name || "House Party Distro";
  // Localhost sends link to localhost (so a test send opens where the code is
  // running); anywhere else, the tenant's canonical domain.
  const origin = req.nextUrl.origin;
  const base = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin) ? origin : appBaseUrlForSlug(slug);
  const url = `${base}/designer/${token}`;
  let emailSent = false;
  if (designerEmail) {
    try {
      // Designer-facing mail comes from, and replies to, the creative desk
      // (Jon, Aug 26) — not production@.
      const creative = process.env.EMAIL_FROM_CREATIVE || "creative@housepartydistro.com";
      const from = `${tenantName} <${creative}>`;
      const typeWord = b.type === "creative" ? "creative art" : b.type === "vector" ? "a vector clean-up" : "separations";
      const html = renderBrandedEmail({
        eyebrow: tenantName, heading: "Work order",
        greeting: b.designerName ? `Hi ${String(b.designerName).trim()},` : "Hi,",
        bodyHtml: `<p style="margin:0 0 14px;">We need ${typeWord} on <strong>${escapeHtml((brief as any).title || "a design")}</strong>${b.dueBy ? `, due <strong>${escapeHtml(String(b.dueBy))}</strong>` : ""}.</p>` +
          (b.headline ? `<p style="margin:0 0 14px;"><strong>${escapeHtml(String(b.headline).trim())}</strong></p>` : "") +
          `<p style="margin:0 0 14px;">The brief is pinned right on the reference images at the link below, with every file to download. Deliver your file on that same page, no account needed. Questions go there too.</p>`,
        cta: { label: "Open the work order", url, style: "dark" },
        hint: "This link is yours for this job only. It stays live until the file is accepted.",
      });
      await resendForSlug(slug).emails.send({ from, to: designerEmail, replyTo: creative, subject: `Work order — ${(brief as any).title || "design"}`, html });
      emailSent = true;
      await db.from("design_work_orders").update({ sent_at: now } as never).eq("id", (wo as any).id);
    } catch (e) { console.error("[designer-door] email failed", (e as any)?.message || e); }
  }
  // The design's own thread keeps the record (internal — the client never sees Room 2).
  await db.from("art_brief_messages").insert({ brief_id: params.id, sender_role: "hpd", sender_name: who.name, message: `Handed to a designer (${b.type})${b.designerName || designerEmail ? ` — ${b.designerName || designerEmail}` : ""}${b.dueBy ? `, due ${b.dueBy}` : ""}.`, visibility: "internal" } as never);
  await db.from("art_briefs").update({ updated_at: now } as never).eq("id", params.id);

  return NextResponse.json({ workOrder: { ...(wo as any), sent_at: emailSent ? now : null }, url, emailSent });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
