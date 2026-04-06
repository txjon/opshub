import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@supabase/supabase-js";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

function getGmailAuth() {
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
    clientOptions: {
      subject: "hello@housepartydistro.com",
    },
  });
}

/**
 * Poll Gmail for inbound replies to OpsHub projects.
 * Looks for emails sent to hello+opshub.{jobId}@housepartydistro.com
 * Extracts body, saves to email_messages, marks as read.
 *
 * Called by Vercel cron every 5 minutes.
 */
export async function GET(req: NextRequest) {
  // Auth: cron secret or internal key
  const authHeader = req.headers.get("authorization");
  const internalKey = req.headers.get("x-internal-key");
  const validCron = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validInternal = internalKey === process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!validCron && !validInternal) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();
    const gmail = google.gmail({ version: "v1", auth: getGmailAuth() });

    // Search for unread emails sent to hello+opshub.* addresses
    const listRes = await gmail.users.messages.list({
      userId: "me",
      q: "to:hello+opshub is:unread",
      maxResults: 20,
    });

    const messages = listRes.data.messages || [];
    if (messages.length === 0) {
      return NextResponse.json({ processed: 0 });
    }

    let processed = 0;

    for (const msg of messages) {
      try {
        // Fetch full message
        const fullMsg = await gmail.users.messages.get({
          userId: "me",
          id: msg.id!,
          format: "full",
        });

        const headers = fullMsg.data.payload?.headers || [];
        const getHeader = (name: string) =>
          headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || "";

        const toHeader = getHeader("To") || getHeader("Delivered-To");
        const fromHeader = getHeader("From");
        const subjectHeader = getHeader("Subject");

        // Extract jobId from to address: hello+opshub.{uuid}@housepartydistro.com
        const match = toHeader.match(/opshub\.([a-f0-9-]{36})/i);
        if (!match) {
          // Not an OpsHub reply — mark as read and skip
          await gmail.users.messages.modify({
            userId: "me",
            id: msg.id!,
            requestBody: { removeLabelIds: ["UNREAD"] },
          });
          continue;
        }

        const jobId = match[1];

        // Verify job exists
        const { data: job } = await sb
          .from("jobs")
          .select("id, title")
          .eq("id", jobId)
          .single();

        if (!job) {
          await gmail.users.messages.modify({
            userId: "me",
            id: msg.id!,
            requestBody: { removeLabelIds: ["UNREAD"] },
          });
          continue;
        }

        // Extract body from message payload
        let textBody = "";
        let htmlBody = "";

        function extractParts(payload: any) {
          if (!payload) return;
          const mimeType = payload.mimeType || "";

          if (mimeType === "text/plain" && payload.body?.data) {
            textBody = Buffer.from(payload.body.data, "base64url").toString("utf-8");
          } else if (mimeType === "text/html" && payload.body?.data) {
            htmlBody = Buffer.from(payload.body.data, "base64url").toString("utf-8");
          }

          if (payload.parts) {
            for (const part of payload.parts) {
              extractParts(part);
            }
          }
        }

        extractParts(fullMsg.data.payload);

        // Clean up text body — strip quoted reply content
        if (textBody) {
          // Cut at the first "On ... wrote:" line (common reply delimiter)
          const replyMarker = textBody.search(/\nOn .+wrote:\s*\n/);
          if (replyMarker > 0) {
            textBody = textBody.slice(0, replyMarker).trim();
          }
          // Also cut at "-- " signature delimiter
          const sigMarker = textBody.indexOf("\n-- \n");
          if (sigMarker > 0) {
            textBody = textBody.slice(0, sigMarker).trim();
          }
        }

        // Parse sender
        const fromMatch = fromHeader.match(/^(.+?)\s*<(.+?)>$/);
        const fromName = fromMatch ? fromMatch[1].replace(/"/g, "").trim() : null;
        const fromEmail = fromMatch ? fromMatch[2] : fromHeader;

        // Check for duplicate (same message_id)
        const messageId = getHeader("Message-ID");
        if (messageId) {
          const { data: existing } = await sb
            .from("email_messages")
            .select("id")
            .eq("resend_message_id", messageId)
            .single();
          if (existing) {
            await gmail.users.messages.modify({
              userId: "me",
              id: msg.id!,
              requestBody: { removeLabelIds: ["UNREAD"] },
            });
            continue;
          }
        }

        // Save to email_messages
        await sb.from("email_messages").insert({
          job_id: jobId,
          direction: "inbound",
          from_email: fromEmail,
          from_name: fromName,
          to_emails: [toHeader],
          cc_emails: [],
          subject: subjectHeader || "(no subject)",
          body_text: textBody || null,
          body_html: htmlBody || null,
          resend_message_id: messageId || null,
        });

        // Log activity
        await sb.from("job_activity").insert({
          job_id: jobId,
          user_id: null,
          type: "auto",
          message: `Email received from ${fromName || fromEmail}: "${subjectHeader || "(no subject)"}"`,
        });

        // Notify team
        const { data: profiles } = await sb.from("profiles").select("id");
        if (profiles?.length) {
          await sb.from("notifications").insert(
            profiles.map((p: any) => ({
              user_id: p.id,
              type: "alert",
              message: `Email reply — ${fromName || fromEmail} · ${job.title}: "${(subjectHeader || "").slice(0, 50)}"`,
              reference_id: jobId,
              reference_type: "job",
            }))
          );
        }

        // Mark as read in Gmail
        await gmail.users.messages.modify({
          userId: "me",
          id: msg.id!,
          requestBody: { removeLabelIds: ["UNREAD"] },
        });

        processed++;
      } catch (msgErr) {
        console.error("[Gmail] Error processing message:", msg.id, msgErr);
      }
    }

    return NextResponse.json({ processed, total: messages.length });
  } catch (e: any) {
    console.error("[Gmail] Check error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
