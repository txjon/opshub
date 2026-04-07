export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const body = await req.json();
    const { jobId, toEmail, ccEmails, subject, channel, decoratorId } = body;
    const emailBody: string = body.body;

    if (!jobId || !toEmail || !subject || !emailBody) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

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

    const isProduction = channel === "production";

    // Build reply-to address — all route through hello@ (Resend rejects production+ format)
    // Client: hello+c.{jobId}@  |  Production: hello+p.{jobId}.{decId}@
    // FROM still shows production@ to decorators — reply-to is invisible to them
    const decId = decoratorId && /^[a-f0-9-]{36}$/i.test(decoratorId) ? decoratorId : null;
    let replyToAddr: string;
    if (isProduction) {
      replyToAddr = decId
        ? `hello+p.${jobId}.${decId}@housepartydistro.com`
        : `hello+p.${jobId}@housepartydistro.com`;
    } else {
      replyToAddr = `hello+c.${jobId}@housepartydistro.com`;
    }

    const fromAddr = isProduction
      ? (process.env.EMAIL_FROM_PO || "production@housepartydistro.com")
      : (process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev");

    const htmlBody = emailBody
      .split("\n")
      .map((line: string) => line.trim() === "" ? "<br/>" : `<p>${line}</p>`)
      .join("");
    const fullHtml = `${htmlBody}<p style="margin-top:24px;font-size:12px;color:#999">—<br/>House Party Distro${job.job_number ? ` · ${job.job_number}` : ""}</p>`;

    // Send via Resend
    const { data: emailData, error: emailError } = await resend.emails.send({
      from: fromAddr,
      to: toEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      replyTo: [replyToAddr],
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
      decorator_id: decId,
      from_email: fromAddr,
      from_name: "House Party Distro",
      to_emails: [toEmail],
      cc_emails: ccEmails || [],
      subject,
      body_text: emailBody,
      body_html: fullHtml,
      resend_message_id: emailData?.id || null,
    });

    // Log to activity
    const channelLabel = isProduction ? "Production email" : "Email";
    await adminClient.from("job_activity").insert({
      job_id: jobId,
      user_id: user.id,
      type: "auto",
      message: `${channelLabel} sent to ${toEmail}: "${subject}"`,
    });

    return NextResponse.json({ success: true, id: emailData?.id });
  } catch (e: any) {
    console.error("Compose email error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
