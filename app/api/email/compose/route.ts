export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

/**
 * Compose and send a free-form email from within a project.
 * Reply-to is routed back to OpsHub when RESEND_INBOUND_DOMAIN is set.
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { jobId, toEmail, ccEmails, subject, body, channel, decoratorId } = await req.json();

    if (!jobId || !toEmail || !subject || !body) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Get job info for context
    const adminClient = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    const { data: job } = await adminClient
      .from("jobs")
      .select("id, title, job_number")
      .eq("id", jobId)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Reply-to routing: production emails go to production@, client emails to hello@
    const isProduction = channel === "production";
    const decIdClean = decoratorId && decoratorId.length > 10 ? decoratorId : "";
    const replyTo = isProduction
      ? `production+opshub.${jobId}${decIdClean ? `.${decIdClean}` : ""}@housepartydistro.com`
      : `hello+opshub.${jobId}@housepartydistro.com`;

    const fromAddress = isProduction
      ? (process.env.EMAIL_FROM_PO || "production@housepartydistro.com")
      : (process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev");

    // Build HTML body
    const htmlBody = body
      .split("\n")
      .map((line: string) => line.trim() === "" ? "<br/>" : `<p>${line}</p>`)
      .join("");

    const fullHtml = `${htmlBody}<p style="margin-top:24px;font-size:12px;color:#999">—<br/>House Party Distro${job.job_number ? ` · ${job.job_number}` : ""}</p>`;

    // Send via Resend
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: fromAddress,
      to: toEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      ...(replyTo ? { replyTo: replyTo } : {}),
      subject,
      html: fullHtml,
    });

    if (emailError) {
      return NextResponse.json({ error: emailError.message }, { status: 500 });
    }

    // Save to email_messages
    await adminClient.from("email_messages").insert({
      job_id: jobId,
      direction: "outbound",
      channel: isProduction ? "production" : "client",
      decorator_id: decoratorId || null,
      from_email: fromAddress,
      from_name: "House Party Distro",
      to_emails: [toEmail],
      cc_emails: ccEmails || [],
      subject,
      body_text: body,
      body_html: fullHtml,
      resend_message_id: emailData?.id || null,
    });

    // Log to activity
    await adminClient.from("job_activity").insert({
      job_id: jobId,
      user_id: user.id,
      type: "auto",
      message: `Email sent to ${toEmail}: "${subject}"`,
    });

    return NextResponse.json({ success: true, id: emailData?.id });
  } catch (e: any) {
    console.error("Compose email error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
