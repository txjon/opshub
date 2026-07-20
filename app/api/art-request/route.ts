export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import { appBaseUrlForSlug } from "@/lib/public-url";

// Create + send an art pricing request to an outside graphic artist. The
// designer gets a tokenized gallery link (no login, no raw Drive link) where
// they can download the job's art files and reply with a price + screen count.
// Email-back v1 — the returned number is entered manually as an Additional
// charge on the quote. See migration 128 + /art-request/[token].
// List a job's art requests (with any submitted quotes) for the in-app panel.
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const jobId = req.nextUrl.searchParams.get("jobId");
  if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
  const admin = createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data, error } = await admin
    .from("art_requests")
    .select("id, token, designer_email, designer_name, status, file_ids, quoted_amount, quoted_items, quoted_note, responded_at, created_at")
    .eq("job_id", jobId)
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ requests: data || [] });
}

export async function POST(req: NextRequest) {
  try {
    // Auth — must be a signed-in team member (this is a dashboard action).
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { jobId, designerEmail, designerName, message, fileIds } = await req.json();
    if (!jobId || !designerEmail) {
      return NextResponse.json({ error: "Missing jobId or designerEmail" }, { status: 400 });
    }
    if (!Array.isArray(fileIds) || fileIds.length === 0) {
      return NextResponse.json({ error: "Select at least one file to share" }, { status: 400 });
    }

    const admin = createAdmin(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );

    // Job + tenant for branding / base URL / resend key.
    const { data: job } = await admin
      .from("jobs")
      .select("id, title, job_number, company_id, clients(name), companies:company_id(slug, name)")
      .eq("id", jobId)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    // Only share files that actually belong to THIS job — never trust the
    // client's id list blindly (privacy + tamper guard).
    const { data: jobItems } = await admin.from("items").select("id").eq("job_id", jobId);
    const itemIdSet = new Set((jobItems || []).map((i: any) => i.id));
    const { data: fileRows } = await admin
      .from("item_files")
      .select("id, item_id")
      .in("id", fileIds);
    const validFileIds = (fileRows || []).filter((f: any) => itemIdSet.has(f.item_id)).map((f: any) => f.id);
    if (validFileIds.length === 0) {
      return NextResponse.json({ error: "None of the selected files belong to this job" }, { status: 400 });
    }

    const slug = (job as any).companies?.slug || "hpd";
    const clientName = (job as any).clients?.name || "";
    const jobLabel = (job as any).title || (job as any).job_number || "your project";

    // Create the request row.
    const token = randomUUID().replace(/-/g, "");
    const { error: insErr } = await admin.from("art_requests").insert({
      token,
      job_id: jobId,
      company_id: (job as any).company_id || null,
      designer_email: designerEmail,
      designer_name: designerName || null,
      message: message || null,
      file_ids: validFileIds,
      created_by: user.id,
    });
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    const galleryUrl = `${appBaseUrlForSlug(slug)}/art-request/${token}`;

    // Send the branded email. Reply-to Jon so the designer's response lands
    // where he's watching.
    const resend = resendForSlug(slug);
    const from = process.env.EMAIL_FROM_PO || "production@housepartydistro.com";
    const tenantName = (job as any).companies?.name || "House Party Distro";

    const noteHtml = message
      ? `<p style="margin:0 0 14px;white-space:pre-wrap;">${escapeHtml(message)}</p>`
      : "";
    const bodyHtml =
      `<p style="margin:0 0 14px;">We'd like a quote for the artwork on <strong>${escapeHtml(String(jobLabel))}</strong>${clientName ? ` (${escapeHtml(clientName)})` : ""}.</p>` +
      noteHtml +
      `<p style="margin:0 0 14px;">Please review the art at the link below — you can download every file directly, no account needed. Reply to this email with your <strong>price</strong> and <strong>screen count</strong>.</p>`;

    const html = renderBrandedEmail({
      eyebrow: tenantName,
      heading: "Art pricing request",
      greeting: designerName ? `Hi ${designerName},` : "Hi,",
      bodyHtml,
      cta: { label: "View & download art", url: galleryUrl, style: "dark" },
      hint: "This link stays live so you can pull the files whenever you're ready.",
    });

    let emailSent = true;
    try {
      await resend.emails.send({
        from,
        to: designerEmail,
        replyTo: "jon@housepartydistro.com",
        subject: `Art pricing request — ${jobLabel}`,
        html,
      });
    } catch (e) {
      emailSent = false;
    }

    // Log to the job activity feed (service-role insert).
    await admin.from("job_activity").insert({
      job_id: jobId,
      user_id: user.id,
      type: "auto",
      message: `Art pricing request sent to ${designerName || designerEmail}`,
      metadata: { designer_email: designerEmail, token },
    });

    return NextResponse.json({ ok: true, token, url: galleryUrl, emailSent });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed" }, { status: 500 });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
