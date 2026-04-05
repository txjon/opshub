export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getPortalUrl, getVendorPortalUrl } from "@/lib/auto-email";

export async function POST(req: NextRequest) {
  try {
    // Auth check — only logged-in users can send emails
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { type, jobId, vendor, recipientEmail, ccEmails, recipientName, subject, customBody } = await req.json();

    if (!recipientEmail || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Simple HTML email (no attachment) — used for proof/mockup links
    if (type === "proof_link" && customBody) {
      // Append portal link so client can approve directly
      let proofHtml = customBody;
      if (jobId) {
        const portalUrl = await getPortalUrl(jobId);
        if (portalUrl) {
          proofHtml += `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#4361ee;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px">Review & Approve in Portal</a></p>`;
        }
      }
      const inboundDomain = process.env.RESEND_INBOUND_DOMAIN;
      const proofReplyTo = (inboundDomain && jobId) ? `reply+${jobId}@${inboundDomain}` : undefined;
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
        to: recipientEmail,
        ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
        ...(proofReplyTo ? { replyTo: proofReplyTo } : {}),
        subject: subject || "File for Review — House Party Distro",
        html: proofHtml,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ success: true, id: data?.id });
    }

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Build the internal PDF URL
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

    let pdfUrl: string;
    let fromAddress: string;
    let defaultSubject: string;
    let filename: string;

    if (type === "quote") {
      pdfUrl = `${baseUrl}/api/pdf/quote/${jobId}`;
      fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
      defaultSubject = subject || "Your Quote from House Party Distro";
      filename = `quote-${jobId.slice(0, 8)}.pdf`;
    } else if (type === "po") {
      pdfUrl = `${baseUrl}/api/pdf/po/${jobId}?download=1${vendor ? `&vendor=${encodeURIComponent(vendor)}` : ""}`;
      fromAddress = process.env.EMAIL_FROM_PO || "onboarding@resend.dev";
      defaultSubject = subject || "Purchase Order from House Party Distro";
      filename = `po-${jobId.slice(0, 8)}.pdf`;
    } else if (type === "invoice") {
      pdfUrl = `${baseUrl}/api/pdf/invoice/${jobId}?download=1`;
      fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
      defaultSubject = subject || "Invoice from House Party Distro";
      filename = `invoice-${jobId.slice(0, 8)}.pdf`;
    } else if (type === "invoice_proofs") {
      pdfUrl = `${baseUrl}/api/pdf/invoice-proofs/${jobId}?download=1`;
      fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
      defaultSubject = subject || "Invoice & Proofs — House Party Distro";
      filename = `invoice-proofs-${jobId.slice(0, 8)}.pdf`;
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // Generate the PDF by calling our own endpoint (internal call, pass secret key)
    const pdfRes = await fetch(pdfUrl, {
      headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "" },
    });
    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      return NextResponse.json({ error: `PDF generation failed: ${text}` }, { status: 500 });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    // Get QB payment link if available (for invoice emails)
    let qbPaymentLink = "";
    if ((type === "invoice" || type === "invoice_proofs") && jobId) {
      const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: jobData } = await adminClient.from("jobs").select("type_meta").eq("id", jobId).single();
      qbPaymentLink = jobData?.type_meta?.qb_payment_link || "";
    }

    const payButton = qbPaymentLink
      ? `<p style="margin:20px 0"><a href="${qbPaymentLink}" style="display:inline-block;padding:12px 28px;background:#34c97a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">Pay Online</a></p>`
      : "";

    // Portal link for client-facing emails (quote, invoice — not PO)
    let portalButton = "";
    if (type !== "po") {
      const portalUrl = await getPortalUrl(jobId);
      if (portalUrl) {
        portalButton = `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#4361ee;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px">View Project Portal</a></p>`;
      }
    }

    // Vendor portal link for PO emails
    let vendorPortalButton = "";
    if (type === "po" && vendor) {
      const vendorPortalUrl = await getVendorPortalUrl(vendor);
      if (vendorPortalUrl) {
        vendorPortalButton = `<p style="margin:16px 0"><a href="${vendorPortalUrl}" style="display:inline-block;padding:10px 24px;background:#4361ee;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px">View in Vendor Portal</a></p>`;
      }
    }

    // Reply-to routing: replies come back to OpsHub when RESEND_INBOUND_DOMAIN is set
    const inboundDomain = process.env.RESEND_INBOUND_DOMAIN;
    const replyTo = (inboundDomain && jobId) ? `reply+${jobId}@${inboundDomain}` : undefined;

    // Send via Resend
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      ...(replyTo ? { replyTo: replyTo } : {}),
      subject: defaultSubject,
      html: type === "quote"
        ? `<p>Hi,</p><p>Here's your quote — take a look and let us know if you have any questions or want to make changes.</p>${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`
        : type === "invoice_proofs"
        ? `<p>Hi,</p><p>Attached is your invoice along with print proofs for review. Please take a look at the proofs and let us know if everything looks good or if you'd like any revisions.</p>${payButton}${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`
        : type === "invoice"
        ? `<p>Hi,</p><p>Attached is your invoice. Let us know if you have any questions.</p>${payButton}${portalButton}<p>Welcome to the party,<br/>House Party Distro</p>`
        : `<p>Hi,</p><p>Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.</p>${vendorPortalButton}<p>You can confirm receipt, update production status, and enter tracking directly from the portal.</p><p>Thanks,<br/>House Party Distro</p>`,
      attachments: [
        {
          filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Save to email_messages for thread view (fire-and-forget)
    try {
      const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      await adminClient.from("email_messages").insert({
        job_id: jobId,
        direction: "outbound",
        from_email: fromAddress,
        from_name: "House Party Distro",
        to_emails: [recipientEmail],
        cc_emails: ccEmails || [],
        subject: defaultSubject,
        body_text: type === "po" ? `Purchase order attached (${filename})` : `${type} attached (${filename})`,
        resend_message_id: data?.id || null,
      });
    } catch {} // Non-fatal

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}
