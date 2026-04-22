import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import crypto from "crypto";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrl } from "@/lib/public-url";

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
      .select("id, title, client_intake_token, client_id, job_id, clients(name, portal_token)")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    // Mint per-brief intake token (used inside portal as a fallback / direct link)
    let briefToken = (brief as any).client_intake_token;
    if (!briefToken) {
      briefToken = crypto.randomBytes(16).toString("hex");
      await supabase.from("art_briefs").update({ client_intake_token: briefToken }).eq("id", brief_id);
    }

    // Mint client portal token if the client doesn't have one yet (pre-migration row)
    let clientPortalToken = (brief as any).clients?.portal_token;
    if (!clientPortalToken && (brief as any).client_id) {
      clientPortalToken = crypto.randomBytes(16).toString("hex");
      await supabase.from("clients").update({ portal_token: clientPortalToken }).eq("id", (brief as any).client_id);
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

    const base = appBaseUrl();
    // Prefer the client-wide portal URL — covers every open brief they have.
    // Fall back to the per-brief intake URL if the client somehow has no portal token.
    const portalUrl = clientPortalToken ? `${base}/portal/client/${clientPortalToken}` : `${base}/art-intake/${briefToken}`;
    const intakeUrl = portalUrl; // response compat — callers relied on this name
    const clientName = (brief as any).clients?.name || "there";
    const title = (brief as any).title || "art brief";
    const multipleRequestsLikely = !!clientPortalToken;

    if (!process.env.RESEND_API_KEY) {
      return NextResponse.json({ error: "Email not configured (RESEND_API_KEY missing)" }, { status: 500 });
    }

    const noteHtml = note?.trim()
      ? `<p style="font-size:14px;color:#444;line-height:1.55;margin:0 0 16px;">${note.trim().replace(/\n/g, "<br/>")}</p>`
      : "";

    const lead = multipleRequestsLikely
      ? `To kick off <strong>${title}</strong>, we need a few things from you — what it's for, some reference images, and a vibe. Your link below is a permanent home for every art request we have in flight together, so you can come back any time.`
      : `To kick off <strong>${title}</strong>, we need just a few things from you — what it's for, some reference images, and a vibe. It takes two minutes.`;

    const ctaLabel = multipleRequestsLikely ? "Open your art requests →" : "Open the brief →";

    const html = renderBrandedEmail({
      heading: "Quick art brief — 2 minutes",
      greeting: `Hi ${clientName},`,
      bodyHtml: lead,
      extraHtml: noteHtml,
      cta: { label: ctaLabel, url: portalUrl, style: "dark" },
      hint: multipleRequestsLikely
        ? "Bookmark this link. Every art request we have in motion for you lives here."
        : "The link is permanent — come back anytime to update your answers.",
      closing: "",
    });

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

    return NextResponse.json({ success: true, recipients, portalUrl, intakeUrl });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
