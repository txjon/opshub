export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";

// POST /api/menu/respond — staff sends the tailored response to a menu
// lead from /intake. { leadId, subject, body } (body = plain text; staff
// edits the prefilled draft before sending). Sends from hello@ with
// reply-to hello@ so the thread lands in the watched mailbox, then flips
// the lead to 'responded' and stores what was sent.

const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const leadId = String(body?.leadId || "");
  const subject = String(body?.subject || "").trim().slice(0, 200);
  const text = String(body?.body || "").trim().slice(0, 8000);
  if (!leadId || !subject || !text) {
    return NextResponse.json({ error: "leadId, subject, and body are required." }, { status: 400 });
  }

  const { data: lead } = await supabase
    .from("menu_leads")
    .select("id,email,token")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "housepartydistro.com";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const menuLink = `${proto}://${host}/build/${lead.token}`;

  try {
    await resendForSlug("hpd").emails.send({
      from: `House Party Distro <${FROM_EMAIL}>`,
      to: lead.email,
      replyTo: FROM_EMAIL,
      subject,
      text: `${text}\n\nYour link: ${menuLink}`,
      html: renderBrandedEmail({
        heading: subject,
        bodyHtml: `<div style="white-space:pre-wrap;">${escapeHtml(text)}</div>`,
        cta: { label: "Open The Build", url: menuLink },
        hint: "Reply to this email any time.",
      }),
    });
  } catch (err) {
    console.error("menu respond send failed", err);
    return NextResponse.json({ error: "Email send failed. Nothing was recorded — try again." }, { status: 502 });
  }

  const { error } = await supabase
    .from("menu_leads")
    .update({
      status: "responded",
      responded_at: new Date().toISOString(),
      response: { subject, body: text, by: user.email || user.id, sent_at: new Date().toISOString() },
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", leadId);
  if (error) return NextResponse.json({ error: "Sent, but recording failed — check the lead." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
