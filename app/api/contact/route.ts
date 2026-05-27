import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";

// Public contact form endpoint. POST { name, email, company, subject,
// message, website } → sends an email to hello@housepartydistro.com with
// reply-to set to the sender. `website` is a honeypot — bots fill hidden
// fields, humans don't, so a non-empty value silently 200's without
// sending.

const TO_EMAIL = "hello@housepartydistro.com";
const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { name, email, company, subject, message, website } = body || {};

  // Honeypot trap — pretend it worked so bots don't retry.
  if (typeof website === "string" && website.trim().length > 0) {
    return NextResponse.json({ ok: true });
  }

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return NextResponse.json(
      { error: "Name, email, and message are required." },
      { status: 400 }
    );
  }
  // Basic email shape check — Resend will also reject malformed
  // addresses but we want to fail fast.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return NextResponse.json({ error: "Invalid email address." }, { status: 400 });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY not configured");
    return NextResponse.json({ error: "Email service unavailable." }, { status: 500 });
  }
  const resend = new Resend(process.env.RESEND_API_KEY);

  const subj = subject?.trim() || "(no subject)";
  const cleanName = name.trim();
  const cleanEmail = email.trim();
  const cleanCompany = company?.trim();

  const text = [
    `From: ${cleanName} <${cleanEmail}>`,
    cleanCompany ? `Company: ${cleanCompany}` : null,
    `Subject: ${subj}`,
    "",
    message.trim(),
  ].filter(Boolean).join("\n");

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Helvetica Neue',sans-serif;color:#1a1a1a;line-height:1.6;">
      <h2 style="margin:0 0 16px;font-size:18px;">New contact form submission</h2>
      <table style="border-collapse:collapse;margin-bottom:20px;">
        <tr><td style="padding:4px 12px 4px 0;color:#6b6b78;font-size:13px;">From</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(cleanName)} &lt;${escapeHtml(cleanEmail)}&gt;</td></tr>
        ${cleanCompany ? `<tr><td style="padding:4px 12px 4px 0;color:#6b6b78;font-size:13px;">Company</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(cleanCompany)}</td></tr>` : ""}
        <tr><td style="padding:4px 12px 4px 0;color:#6b6b78;font-size:13px;">Subject</td><td style="padding:4px 0;font-size:13px;">${escapeHtml(subj)}</td></tr>
      </table>
      <div style="white-space:pre-wrap;padding:16px;background:#f5f5f7;border-left:3px solid #73B6C9;font-size:14px;">${escapeHtml(message.trim())}</div>
    </div>
  `;

  try {
    await resend.emails.send({
      from: `House Party Distro <${FROM_EMAIL}>`,
      to: TO_EMAIL,
      replyTo: cleanEmail,
      subject: `[Contact] ${cleanName}: ${subj}`,
      text,
      html,
    });
  } catch (err: any) {
    console.error("Contact send failed", err);
    return NextResponse.json({ error: "Could not send. Try again later." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
