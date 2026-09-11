export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { quoteTotal, type Quote, type QuoteLine, type PunchPoint } from "@/lib/menu-quote";

// POST /api/menu/quote-send — staff sends (or re-sends) the Quick Quote.
// { leadId, lines, punch, validUntil }
//
// Re-send keeps the customer's progress: punch payloads/statuses carry
// over for keys that still exist, so editing a price never wipes a size
// grid they already filled in.

const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const leadId = String(body?.leadId || "");
  const lines = (Array.isArray(body?.lines) ? body.lines : []) as QuoteLine[];
  const punch = (Array.isArray(body?.punch) ? body.punch : []) as PunchPoint[];
  const validUntil = String(body?.validUntil || "");
  if (!leadId || !lines.length || !validUntil) {
    return NextResponse.json({ error: "leadId, lines, and validUntil are required." }, { status: 400 });
  }
  if (lines.some((l) => !l.label?.trim() || !(l.qty > 0))) {
    return NextResponse.json({ error: "Every line needs a label and a quantity." }, { status: 400 });
  }

  const { data: lead } = await supabase
    .from("menu_leads")
    .select("id,email,token,quote,contact")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return NextResponse.json({ error: "Lead not found." }, { status: 404 });

  // Carry the customer's punch progress across re-sends.
  const prior = (lead.quote as Quote | null)?.punch || [];
  const mergedPunch = punch.map((p) => {
    const old = prior.find((o) => o.key === p.key);
    return old?.status === "done" ? { ...p, status: "done" as const, payload: old.payload } : p;
  });

  const quote: Quote & { inclShip?: boolean; inclCC?: boolean } = {
    inclShip: body?.inclShip !== false,
    inclCC: body?.inclCC !== false,
    lines,
    punch: mergedPunch,
    validUntil,
    sentAt: new Date().toISOString(),
    acceptedAt: (lead.quote as Quote | null)?.acceptedAt || null,
    total: Number(quoteTotal(lines).toFixed(2)),
  };

  const { error } = await supabase
    .from("menu_leads")
    .update({
      quote,
      status: "quoted",
      quoted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", leadId);
  if (error) return NextResponse.json({ error: "Save failed." }, { status: 500 });

  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "housepartydistro.com";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const link = `${proto}://${host}/build/${lead.token}`;
  const firstName = ((lead.contact as any)?.name || "").trim().split(/\s+/)[0] || "there";
  const priced = lines.filter((l) => l.unitPrice != null);
  const lineHtml = lines.map((l) =>
    `<tr><td style="padding:4px 12px 4px 0;font-size:13px;">${l.label}${l.colors.length ? ` · ${l.colors.join(", ")}` : ""}</td><td style="padding:4px 12px;font-size:13px;text-align:right;">${l.qty}</td><td style="padding:4px 0;font-size:13px;text-align:right;">${l.unitPrice != null ? `$${l.unitPrice.toFixed(2)}/pc` : "quoted on art"}</td></tr>`
  ).join("");

  try {
    await resendForSlug("hpd").emails.send({
      from: `House Party Distro <${FROM_EMAIL}>`,
      to: lead.email,
      replyTo: FROM_EMAIL,
      subject: "Your House Party quote is ready",
      html: renderBrandedEmail({
        heading: "Your quote is ready.",
        greeting: `Hi ${firstName},`,
        bodyHtml: `Real numbers, not ranges. Review it, knock out the short checklist, and accept when you are ready. Nothing prints without your approval on the final proof.<br/><br/><table style="border-collapse:collapse;">${lineHtml}</table>${priced.length ? `<p style="font-size:14px;margin:12px 0 0;"><strong>Total: $${quote.total.toLocaleString()}</strong></p>` : ""}`,
        cta: { label: "View your quote", url: link },
        hint: `This quote is good through ${validUntil}. Reply to this email any time.`,
      }),
    });
  } catch (err) {
    console.error("quote email failed", err);
    return NextResponse.json({ ok: true, warning: "Saved, but the email failed to send — resend from the lead." });
  }

  return NextResponse.json({ ok: true });
}
