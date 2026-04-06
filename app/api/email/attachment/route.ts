import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { createClient } from "@/lib/supabase/server";

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
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    clientOptions: {
      subject: "hello@housepartydistro.com",
    },
  });
}

/**
 * On-demand attachment fetch from Gmail.
 * GET /api/email/attachment?messageId=xxx&attachmentId=yyy
 *
 * Fetches the attachment data from Gmail and returns it with proper content type.
 * Only authenticated OpsHub users can access this.
 */
export async function GET(req: NextRequest) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const messageId = searchParams.get("messageId");
    const attachmentId = searchParams.get("attachmentId");
    const filename = searchParams.get("filename") || "attachment";
    const mimeType = searchParams.get("mimeType") || "application/octet-stream";

    if (!messageId || !attachmentId) {
      return NextResponse.json({ error: "Missing messageId or attachmentId" }, { status: 400 });
    }

    const gmail = google.gmail({ version: "v1", auth: getGmailAuth() });

    const attachment = await gmail.users.messages.attachments.get({
      userId: "me",
      messageId,
      id: attachmentId,
    });

    if (!attachment.data?.data) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Gmail returns base64url-encoded data
    const buffer = Buffer.from(attachment.data.data, "base64url");

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `inline; filename="${encodeURIComponent(filename)}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (e: any) {
    console.error("Attachment fetch error:", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
