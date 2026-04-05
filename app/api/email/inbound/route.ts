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
 * Resend sends: { type: "email.received", data: { email_id, from, to, subject, text, html, ... } }
 * The "to" field contains the reply+{jobId}@reply.housepartydistro.com address.
 *
 * Setup: Add webhook in Resend dashboard pointing to this URL with "email.received" event.
 * MX record for reply.housepartydistro.com → inbound-smtp.resend.com
 */
export async function POST(req: NextRequest) {
  try {
    const sb = admin();
    const payload = await req.json();

    // Resend wraps in { type, data } or sends flat — handle both
    const emailData = payload.data || payload;
    const from = emailData.from || emailData.from_address;
    const to = emailData.to || emailData.to_addresses || [];
    const cc = emailData.cc || emailData.cc_addresses || [];
    const subject = emailData.subject;
    const text = emailData.text;
    const html = emailData.html;

    // Extract jobId from the "to" address
    // Format: reply+{jobId}@domain
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

    // Save to email_messages
    await sb.from("email_messages").insert({
      job_id: jobId,
      direction: "inbound",
      from_email: fromEmail,
      from_name: fromName,
      to_emails: toAddresses.map((a: any) => typeof a === "string" ? a : a?.address || a?.email || ""),
      cc_emails: ccEmails,
      subject: subject || "(no subject)",
      body_text: text || null,
      body_html: html || null,
    });

    // Log to activity
    await sb.from("job_activity").insert({
      job_id: jobId,
      user_id: null,
      type: "auto",
      message: `Email received from ${fromName || fromEmail}: "${subject || "(no subject)"}"`,
    });

    // Notify team
    const { data: profiles } = await sb.from("profiles").select("id");
    if (profiles?.length) {
      await sb.from("notifications").insert(
        profiles.map((p: any) => ({
          user_id: p.id,
          type: "alert",
          message: `Email reply — ${fromName || fromEmail} · ${job.title}: "${(subject || "").slice(0, 50)}"`,
          reference_id: jobId,
          reference_type: "job",
        }))
      );
    }

    return NextResponse.json({ received: true, routed: true });
  } catch (e: any) {
    console.error("[Inbound] Error:", e);
    // Always return 200 for webhooks
    return NextResponse.json({ received: true, error: e.message });
  }
}
