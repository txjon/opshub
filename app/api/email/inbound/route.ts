export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * Inbound email webhook — receives replies routed via Resend.
 *
 * Resend webhook sends metadata only. We use the email ID to fetch
 * the full email body via the Resend API.
 */
export async function POST(req: NextRequest) {
  try {
    const sb = admin();
    const payload = await req.json();

    // Log raw payload for debugging
    console.log("[Inbound] Raw payload:", JSON.stringify(payload).slice(0, 2000));

    // Resend wraps in { type, data } — unwrap
    const eventData = payload.data || payload;

    // Get email ID to fetch full content
    const emailId = eventData.email_id || eventData.id || eventData.emailId;

    // Extract basic fields from webhook
    const from = eventData.from || eventData.from_address;
    const to = eventData.to || eventData.to_addresses || [];
    const cc = eventData.cc || eventData.cc_addresses || [];
    let subject = eventData.subject;
    let text = eventData.text || eventData.body || null;
    let html = eventData.html || null;

    // Resend webhook doesn't include body content.
    // The body is available via their dashboard, but the API returns 401 for inbound emails.
    // For now, note that a reply was received — the subject line carries context.
    // Full body capture requires Resend to update their inbound webhook payload.

    // Extract jobId from the "to" address
    let jobId: string | null = null;
    const toAddresses = Array.isArray(to) ? to : [to];
    for (const addr of toAddresses) {
      const email = typeof addr === "string" ? addr : addr?.address || addr?.email || "";
      const match = email.match(/reply\+([a-f0-9-]{36})@/i);
      if (match) {
        jobId = match[1];
        break;
      }
    }

    if (!jobId) {
      console.warn("[Inbound] Could not extract jobId from:", toAddresses);
      return NextResponse.json({ received: true, routed: false });
    }

    // Verify job exists
    const { data: job } = await sb
      .from("jobs")
      .select("id, title")
      .eq("id", jobId)
      .single();

    if (!job) {
      console.warn("[Inbound] Job not found:", jobId);
      return NextResponse.json({ received: true, routed: false });
    }

    // Parse sender
    const fromEmail = typeof from === "string" ? from : from?.address || from?.email || "unknown";
    const fromName = typeof from === "string" ? null : from?.name || null;

    // Parse CC
    const ccEmails = (Array.isArray(cc) ? cc : cc ? [cc] : [])
      .map((c: any) => typeof c === "string" ? c : c?.address || c?.email || "")
      .filter(Boolean);

    // Save to email_messages — include raw payload for debugging
    await sb.from("email_messages").insert({
      job_id: jobId,
      direction: "inbound",
      from_email: fromEmail,
      from_name: fromName,
      to_emails: toAddresses.map((a: any) => typeof a === "string" ? a : a?.address || a?.email || ""),
      cc_emails: ccEmails,
      subject: subject || "(no subject)",
      body_text: text || null,
      body_html: html,
    });

    // Log to activity
    await sb.from("job_activity").insert({
      job_id: jobId,
      user_id: null,
      type: "auto",
      message: `Email received from ${fromName || fromEmail}: "${subject || "(no subject)"}"`,
    });

    // Notifications table deprecated — bell UI was removed.

    return NextResponse.json({ received: true, routed: true });
  } catch (e: any) {
    console.error("[Inbound] Error:", e);
    return NextResponse.json({ received: true, error: e.message });
  }
}
