import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";

// POST — email the client intake link to the client's contacts.
// Body: { brief_id, to_emails?: string[], note?: string }
// If to_emails is omitted, picks the job's primary/billing contact email(s), else the client's first contact.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, to_emails, note } = await req.json();
    if (!brief_id) return NextResponse.json({ error: "brief_id required" }, { status: 400 });

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("id, title, client_intake_token, client_id, job_id, clients(name)")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    // Mint a token if one doesn't exist yet
    let token = (brief as any).client_intake_token;
    if (!token) {
      token = crypto.randomBytes(16).toString("hex");
      await supabase.from("art_briefs").update({ client_intake_token: token }).eq("id", brief_id);
    }

    // Figure out recipients
    let recipients: string[] = [];
    if (Array.isArray(to_emails) && to_emails.length > 0) {
      recipients = to_emails.filter((e: any) => typeof e === "string" && e.includes("@"));
    } else if ((brief as any).job_id) {
      const { data: jc } = await supabase
        .from("job_contacts")
        .select("contacts(email, name), role_on_job")
        .eq("job_id", (brief as any).job_id);
      recipients = ((jc as any) || [])
        .filter((x: any) => ["primary", "billing", "creative"].includes(x.role_on_job) && x.contacts?.email)
        .map((x: any) => x.contacts.email);
      if (recipients.length === 0) {
        const any = ((jc as any) || []).filter((x: any) => x.contacts?.email).map((x: any) => x.contacts.email);
        if (any.length) recipients = [any[0]];
      }
    } else if ((brief as any).client_id) {
      const { data: cc } = await supabase
        .from("contacts")
        .select("email")
        .eq("client_id", (brief as any).client_id)
        .not("email", "is", null)
        .limit(1);
      recipients = ((cc as any) || []).map((c: any) => c.email).filter(Boolean);
    }

    if (recipients.length === 0) {
      return NextResponse.json({ error: "No client contacts with email on file — add one first, or supply to_emails" }, { status: 400 });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_VERCEL_URL || "https://opshub-umber.vercel.app";
    const intakeUrl = `${siteUrl.startsWith("http") ? siteUrl : "https://" + siteUrl}/art-intake/${token}`;
    const clientName = (brief as any).clients?.name || "there";
    const title = (brief as any).title || "art brief";

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Email not configured (RESEND_API_KEY missing)" }, { status: 500 });
    }

    const noteHtml = note?.trim()
      ? `<p style="font-size: 14px; color: #444; line-height: 1.5; margin: 0 0 16px;">${note.trim().replace(/\n/g, "<br/>")}</p>`
      : "";

    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 20px;">
        <div style="font-size: 11px; color: #888; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; margin-bottom: 6px;">House Party Distro</div>
        <h1 style="font-size: 22px; margin: 0 0 14px;">Quick art brief — 2 minutes</h1>
        <p style="font-size: 14px; color: #444; line-height: 1.5; margin: 0 0 16px;">
          Hi ${clientName},<br/><br/>
          To kick off <strong>${title}</strong>, we need just a few things from you — what it's for,
          some reference images, and a vibe. It takes two minutes.
        </p>
        ${noteHtml}
        <a href="${intakeUrl}" style="display: inline-block; padding: 12px 24px; background: #222; color: #fff; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 14px;">
          Open the brief →
        </a>
        <p style="font-size: 12px; color: #888; margin-top: 20px;">
          The link is permanent — come back anytime to update your answers.
        </p>
      </div>
    `;

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com",
        to: recipients,
        subject: `${title} — quick brief from House Party Distro`,
        html,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      return NextResponse.json({ error: `Resend error: ${err}` }, { status: 500 });
    }

    // Log to job activity if linked
    if ((brief as any).job_id) {
      await supabase.from("job_activity").insert({
        job_id: (brief as any).job_id,
        user_id: null,
        type: "auto",
        message: `Sent art-brief intake link to ${recipients.join(", ")} (${title})`,
      });
    }

    return NextResponse.json({ success: true, recipients, intakeUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
