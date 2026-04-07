import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

function getGmailAuth(impersonate: string) {
  let key: any;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/gmail.modify"],
    clientOptions: { subject: impersonate },
  });
}

type InboxConfig = {
  email: string;
  searchQuery: string;
  channel: "client" | "production";
};

const INBOXES: InboxConfig[] = [
  { email: "hello@housepartydistro.com", searchQuery: "to:hello+opshub is:unread", channel: "client" },
  { email: "production@housepartydistro.com", searchQuery: "to:production+opshub is:unread", channel: "production" },
];

/**
 * Poll Gmail for inbound replies to OpsHub projects.
 * Checks both hello@ (client) and production@ (decorator) inboxes.
 *
 * Client emails: hello+opshub.{jobId}@housepartydistro.com
 * Production emails: production+opshub.{jobId}.{decoratorId}@housepartydistro.com
 *
 * Called by Vercel cron every 5 minutes.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const internalKey = req.headers.get("x-internal-key");
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validInternal = internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!validCron && !validInternal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();
    let totalProcessed = 0;

    for (const inbox of INBOXES) {
      try {
        const gmail = google.gmail({ version: "v1", auth: getGmailAuth(inbox.email) });

        const listRes = await gmail.users.messages.list({
          userId: "me",
          q: inbox.searchQuery,
          maxResults: 20,
        });

        const messages = listRes.data.messages || [];
        if (messages.length === 0) continue;

        for (const msg of messages) {
          try {
            const processed = await processMessage(gmail, sb, msg.id!, inbox.channel);
            if (processed) totalProcessed++;
          } catch (msgErr) {
            console.error(`[Gmail] Error processing ${inbox.channel} message:`, msg.id, msgErr);
          }
        }
      } catch (inboxErr) {
        console.error(`[Gmail] Error polling ${inbox.email}:`, inboxErr);
      }
    }

    return NextResponse.json({ processed: totalProcessed });
  } catch (e: any) {
    console.error("[Gmail] Check error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

async function processMessage(
  gmail: any,
  sb: any,
  messageId: string,
  channel: "client" | "production"
): Promise<boolean> {
  const fullMsg = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });

  const headers = fullMsg.data.payload?.headers || [];
  const getHeader = (name: string) =>
    headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

  const toHeader = getHeader("To") || getHeader("Delivered-To");
  const fromHeader = getHeader("From");
  const subjectHeader = getHeader("Subject");

  // Extract jobId (and optionally decoratorId) from to address
  // Client: hello+opshub.{jobId}@...
  // Production: production+opshub.{jobId}.{decoratorId}@...
  const jobMatch = toHeader.match(/opshub\.([a-f0-9-]{36})/i);
  if (!jobMatch) {
    await gmail.users.messages.modify({
      userId: "me", id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    return false;
  }

  const jobId = jobMatch[1];

  // Extract decorator ID if present (production emails)
  let decoratorId: string | null = null;
  const decMatch = toHeader.match(/opshub\.[a-f0-9-]{36}\.([a-f0-9-]{36})/i);
  if (decMatch) decoratorId = decMatch[1];

  // Verify job exists
  const { data: job } = await sb
    .from("jobs")
    .select("id, title")
    .eq("id", jobId)
    .single();

  if (!job) {
    await gmail.users.messages.modify({
      userId: "me", id: messageId,
      requestBody: { removeLabelIds: ["UNREAD"] },
    });
    return false;
  }

  // Extract body and attachments
  let textBody = "";
  let htmlBody = "";
  const attachments: any[] = [];

  function extractParts(payload: any) {
    if (!payload) return;
    const mimeType = payload.mimeType || "";
    if (mimeType === "text/plain" && payload.body?.data) {
      textBody = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    } else if (mimeType === "text/html" && payload.body?.data) {
      htmlBody = Buffer.from(payload.body.data, "base64url").toString("utf-8");
    }
    if (payload.filename && payload.body?.attachmentId) {
      attachments.push({
        filename: payload.filename,
        mimeType,
        size: payload.body.size || 0,
        gmailMessageId: messageId,
        attachmentId: payload.body.attachmentId,
      });
    }
    if (payload.parts) {
      for (const part of payload.parts) extractParts(part);
    }
  }
  extractParts(fullMsg.data.payload);

  // Clean up text body
  if (textBody) {
    const sigMatch = textBody.match(/\n--\s*\n/);
    if (sigMatch?.index && sigMatch.index > 0) textBody = textBody.slice(0, sigMatch.index).trim();
    const replyMarker = textBody.search(/\n>?\s*On .+wrote:\s*$/m);
    if (replyMarker > 0) textBody = textBody.slice(0, replyMarker).trim();
    const outlookMarker = textBody.search(/\n-{3,}\s*Original Message\s*-{3,}/i);
    if (outlookMarker > 0) textBody = textBody.slice(0, outlookMarker).trim();
    textBody = textBody.split("\n").filter(line => !line.startsWith(">")).join("\n").trim();
  }

  // Parse sender
  const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/);
  const fromName = fromMatch ? fromMatch[1].replace(/"/g, "").trim() : null;
  const fromEmail = fromMatch ? fromMatch[2] : fromHeader;

  // Deduplicate by Message-ID
  const msgId = getHeader("Message-ID");
  if (msgId) {
    const { data: existing } = await sb
      .from("email_messages")
      .select("id")
      .eq("resend_message_id", msgId)
      .single();
    if (existing) {
      await gmail.users.messages.modify({
        userId: "me", id: messageId,
        requestBody: { removeLabelIds: ["UNREAD"] },
      });
      return false;
    }
  }

  // Save to email_messages
  await sb.from("email_messages").insert({
    job_id: jobId,
    direction: "inbound",
    channel,
    decorator_id: decoratorId,
    from_email: fromEmail,
    from_name: fromName,
    to_emails: [toHeader],
    cc_emails: [],
    subject: subjectHeader || "(no subject)",
    body_text: textBody || null,
    body_html: htmlBody || null,
    resend_message_id: msgId || null,
    attachments: attachments.length > 0 ? attachments : [],
  });

  // Log activity
  const channelLabel = channel === "production" ? "Production email" : "Email";
  await sb.from("job_activity").insert({
    job_id: jobId,
    user_id: null,
    type: "auto",
    message: `${channelLabel} received from ${fromName || fromEmail}: "${subjectHeader || "(no subject)"}"`,
  });

  // Notify team
  const { data: profiles } = await sb.from("profiles").select("id");
  if (profiles?.length) {
    await sb.from("notifications").insert(
      profiles.map((p: any) => ({
        user_id: p.id,
        type: "alert",
        message: `${channelLabel} reply — ${fromName || fromEmail} · ${job.title}: "${(subjectHeader || "").slice(0, 50)}"`,
        reference_id: jobId,
        reference_type: "job",
      }))
    );
  }

  // Mark as read
  await gmail.users.messages.modify({
    userId: "me", id: messageId,
    requestBody: { removeLabelIds: ["UNREAD"] },
  });

  return true;
}
