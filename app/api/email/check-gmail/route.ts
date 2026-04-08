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

/**
 * Poll Gmail for inbound replies to OpsHub projects.
 *
 * Two inboxes:
 *   hello@   — client replies (matched by hello+c.{jobId} plus-addressing)
 *   production@ — decorator replies (matched by subject job number + sender email)
 *
 * Called by Vercel cron every 5 minutes.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const internalKey = req.headers.get("x-internal-key");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const sb = admin();
    let totalProcessed = 0;

    // ── 1. Poll hello@ for client replies (plus-addressed) ──
    try {
      const gmail = google.gmail({ version: "v1", auth: getGmailAuth("hello@housepartydistro.com") });
      const listRes = await gmail.users.messages.list({ userId: "me", q: "to:hello+ is:unread", maxResults: 20 });
      for (const msg of (listRes.data.messages || [])) {
        try {
          if (await processClientMessage(gmail, sb, msg.id!)) totalProcessed++;
        } catch (e) { console.error("[Gmail] Client msg error:", msg.id, e); }
      }
    } catch (e) { console.error("[Gmail] hello@ poll error:", e); }

    // ── 2. Poll production@ for decorator replies (smart matching) ──
    try {
      const gmail = google.gmail({ version: "v1", auth: getGmailAuth("production@housepartydistro.com") });
      const listRes = await gmail.users.messages.list({ userId: "me", q: "is:unread -from:housepartydistro.com", maxResults: 20 });
      for (const msg of (listRes.data.messages || [])) {
        try {
          if (await processProductionMessage(gmail, sb, msg.id!)) totalProcessed++;
        } catch (e) { console.error("[Gmail] Production msg error:", msg.id, e); }
      }
    } catch (e) { console.error("[Gmail] production@ poll error:", e); }

    return NextResponse.json({ processed: totalProcessed });
  } catch (e: any) {
    console.error("[Gmail] Check error:", e);
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

// ── Shared: extract body + attachments from Gmail message ──
function extractContent(payload: any, msgId: string) {
  let textBody = "";
  let htmlBody = "";
  const attachments: any[] = [];

  function walk(part: any) {
    if (!part) return;
    const mime = part.mimeType || "";
    if (mime === "text/plain" && part.body?.data) {
      textBody = Buffer.from(part.body.data, "base64url").toString("utf-8");
    } else if (mime === "text/html" && part.body?.data) {
      htmlBody = Buffer.from(part.body.data, "base64url").toString("utf-8");
    }
    if (part.filename && part.body?.attachmentId) {
      attachments.push({ filename: part.filename, mimeType: mime, size: part.body.size || 0, gmailMessageId: msgId, attachmentId: part.body.attachmentId });
    }
    if (part.parts) for (const p of part.parts) walk(p);
  }
  walk(payload);

  // Clean text body
  if (textBody) {
    const sigMatch = textBody.match(/\n--\s*\n/);
    if (sigMatch?.index && sigMatch.index > 0) textBody = textBody.slice(0, sigMatch.index).trim();
    const replyMarker = textBody.search(/\n>?\s*On .+wrote:\s*$/m);
    if (replyMarker > 0) textBody = textBody.slice(0, replyMarker).trim();
    const outlookMarker = textBody.search(/\n-{3,}\s*Original Message\s*-{3,}/i);
    if (outlookMarker > 0) textBody = textBody.slice(0, outlookMarker).trim();
    textBody = textBody.split("\n").filter(line => !line.startsWith(">")).join("\n").trim();
  }

  return { textBody, htmlBody, attachments };
}

function parseFrom(fromHeader: string) {
  const match = fromHeader.match(/^(.+?)\s*<(.+?)>$/);
  return { name: match ? match[1].replace(/"/g, "").trim() : null, email: match ? match[2] : fromHeader };
}

async function saveAndNotify(sb: any, params: {
  jobId: string; jobTitle: string; channel: "client" | "production"; decoratorId: string | null;
  fromEmail: string; fromName: string | null; toHeader: string; subject: string;
  textBody: string; htmlBody: string; attachments: any[]; messageId: string;
}) {
  // Deduplicate
  if (params.messageId) {
    const { data: existing } = await sb.from("email_messages").select("id").eq("resend_message_id", params.messageId).single();
    if (existing) return false;
  }

  await sb.from("email_messages").insert({
    job_id: params.jobId, direction: "inbound", channel: params.channel,
    decorator_id: params.decoratorId, from_email: params.fromEmail, from_name: params.fromName,
    to_emails: [params.toHeader], cc_emails: [], subject: params.subject || "(no subject)",
    body_text: params.textBody || null, body_html: params.htmlBody || null,
    resend_message_id: params.messageId || null,
    attachments: params.attachments.length > 0 ? params.attachments : [],
  });

  const label = params.channel === "production" ? "Production email" : "Email";
  await sb.from("job_activity").insert({
    job_id: params.jobId, user_id: null, type: "auto",
    message: `${label} received from ${params.fromName || params.fromEmail}: "${params.subject || "(no subject)"}"`,
  });

  const { data: profiles } = await sb.from("profiles").select("id");
  if (profiles?.length) {
    await sb.from("notifications").insert(
      profiles.map((p: any) => ({
        user_id: p.id, type: "alert",
        message: `${label} reply — ${params.fromName || params.fromEmail} · ${params.jobTitle}: "${(params.subject || "").slice(0, 50)}"`,
        reference_id: params.jobId, reference_type: "job",
      }))
    );
  }
  return true;
}

// ── Client message: matched by plus-address ──
async function processClientMessage(gmail: any, sb: any, msgId: string): Promise<boolean> {
  const full = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
  const headers = full.data.payload?.headers || [];
  const h = (n: string) => headers.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "";

  const toHeader = h("To") || h("Delivered-To");
  const { name: fromName, email: fromEmail } = parseFrom(h("From"));

  // Extract jobId: hello+c.{uuid}@ or hello+{uuid}@ (legacy)
  const match = toHeader.match(/\+c?\.?([a-f0-9-]{36})/i);
  if (!match) {
    await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
    return false;
  }

  const jobId = match[1];
  const { data: job } = await sb.from("jobs").select("id, title").eq("id", jobId).single();
  if (!job) {
    await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
    return false;
  }

  const { textBody, htmlBody, attachments } = extractContent(full.data.payload, msgId);

  const saved = await saveAndNotify(sb, {
    jobId, jobTitle: job.title, channel: "client", decoratorId: null,
    fromEmail, fromName, toHeader, subject: h("Subject"),
    textBody, htmlBody, attachments, messageId: h("Message-ID"),
  });

  await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
  return saved;
}

// ── Production message: matched by job number in subject + sender ──
async function processProductionMessage(gmail: any, sb: any, msgId: string): Promise<boolean> {
  const full = await gmail.users.messages.get({ userId: "me", id: msgId, format: "full" });
  const headers = full.data.payload?.headers || [];
  const h = (n: string) => headers.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "";

  const toHeader = h("To") || h("Delivered-To");
  const subject = h("Subject") || "";
  const { name: fromName, email: fromEmail } = parseFrom(h("From"));

  // Skip emails sent BY OpsHub (outbound from Resend shows up in the inbox)
  if (fromEmail.includes("housepartydistro.com") && !fromEmail.includes("+")) {
    await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
    return false;
  }

  let jobId: string | null = null;
  let jobTitle: string | null = null;

  // Match 0: Plus-addressed production+po.{jobId}@ (most reliable — from Reply-To)
  const plusMatch = toHeader.match(/production\+po\.([a-f0-9-]{36})/i);
  if (plusMatch) {
    const { data: job } = await sb.from("jobs").select("id, title").eq("id", plusMatch[1]).single();
    if (job) { jobId = job.id; jobTitle = job.title; }
  }

  // Match 1a: Job/quote number in subject (HPD-YYMM-NNN pattern)
  if (!jobId) {
    const jobNumMatch = subject.match(/HPD-\d{4}-\d{3}/i);
    if (jobNumMatch) {
      const { data: job } = await sb.from("jobs").select("id, title").eq("job_number", jobNumMatch[0].toUpperCase()).single();
      if (job) { jobId = job.id; jobTitle = job.title; }
    }
  }

  // Match 1b: Invoice number in subject (e.g. "PO 1042" or "Invoice 1042")
  if (!jobId) {
    const invMatch = subject.match(/(?:HPD\s+)?(?:PO#?|Invoice)\s+(\d+)/i);
    if (invMatch) {
      const { data: job } = await sb.from("jobs").select("id, title").eq("type_meta->>qb_invoice_number", invMatch[1]).single();
      if (job) { jobId = job.id; jobTitle = job.title; }
    }
  }

  // Match 2: If no job number in subject, try matching sender to a decorator contact
  // and find their most recent active job
  if (!jobId) {
    const { data: decs } = await sb.from("decorators").select("id, name, contacts_list").not("contacts_list", "is", null);
    let decoratorId: string | null = null;
    if (decs) {
      for (const dec of decs) {
        const contacts = dec.contacts_list || [];
        if (contacts.some((c: any) => c.email && fromEmail.toLowerCase().includes(c.email.toLowerCase()))) {
          decoratorId = dec.id;
          break;
        }
      }
    }
    if (decoratorId) {
      // Find most recent active job with this decorator
      const { data: assignments } = await sb
        .from("decorator_assignments")
        .select("item_id, items(job_id, jobs(id, title, phase))")
        .eq("decorator_id", decoratorId)
        .limit(10);
      if (assignments) {
        for (const a of assignments) {
          const job = (a as any).items?.jobs;
          if (job && ["production", "receiving", "fulfillment"].includes(job.phase)) {
            jobId = job.id;
            jobTitle = job.title;
            break;
          }
        }
      }
    }
  }

  if (!jobId) {
    // Can't match — mark as read, skip
    await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
    return false;
  }

  // Try to match sender to a decorator
  let decoratorId: string | null = null;
  const { data: decs } = await sb.from("decorators").select("id, contacts_list").not("contacts_list", "is", null);
  if (decs) {
    for (const dec of decs) {
      const contacts = dec.contacts_list || [];
      if (contacts.some((c: any) => c.email && fromEmail.toLowerCase().includes(c.email.toLowerCase()))) {
        decoratorId = dec.id;
        break;
      }
    }
  }

  const { textBody, htmlBody, attachments } = extractContent(full.data.payload, msgId);

  const saved = await saveAndNotify(sb, {
    jobId, jobTitle: jobTitle!, channel: "production", decoratorId,
    fromEmail, fromName, toHeader, subject,
    textBody, htmlBody, attachments, messageId: h("Message-ID"),
  });

  await gmail.users.messages.modify({ userId: "me", id: msgId, requestBody: { removeLabelIds: ["UNREAD"] } });
  return saved;
}
