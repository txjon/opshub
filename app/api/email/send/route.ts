export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getPortalUrl, getVendorPortalUrl } from "@/lib/auto-email";
import { renderBrandedEmail } from "@/lib/email-template";

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

    if (!jobId) {
      return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    }

    // Build the internal PDF URL
    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    let pdfUrl: string;
    let fromAddress: string;
    let defaultSubject: string;
    let filename: string;

    // Load job for document numbers + client name (for greeting)
    const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: jobData } = await adminClient.from("jobs").select("job_number, title, type_meta, clients(name)").eq("id", jobId).single();
    const qbInvNum = (jobData as any)?.type_meta?.qb_invoice_number;
    const jobNum = (jobData as any)?.job_number;
    const projectTitle = (jobData as any)?.title || "";
    const clientGreeting = (jobData as any)?.clients?.name || (recipientName ? recipientName.split(" ")[0] : "there");

    if (type === "quote") {
      pdfUrl = `${baseUrl}/api/pdf/quote/${jobId}`;
      fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
      defaultSubject = subject || `Quote ${jobNum || ""} — House Party Distro`.trim();
      filename = `quote-${jobNum || jobId.slice(0, 8)}.pdf`;
    } else if (type === "po") {
      pdfUrl = `${baseUrl}/api/pdf/po/${jobId}?download=1${vendor ? `&vendor=${encodeURIComponent(vendor)}` : ""}`;
      fromAddress = process.env.EMAIL_FROM_PO || "onboarding@resend.dev";
      defaultSubject = subject || `HPD PO# ${qbInvNum || jobNum || ""} — House Party Distro`.trim();
      filename = `po-${qbInvNum || jobNum || jobId.slice(0, 8)}.pdf`;
    } else if (type === "invoice") {
      pdfUrl = `${baseUrl}/api/pdf/invoice/${jobId}?download=1`;
      fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
      // Standard post-invoice subject format: "Invoice — [Client] · Invoice [#] · [Project]"
      const clientName = (jobData as any)?.clients?.name || "";
      defaultSubject = subject || `Invoice — ${clientName}${qbInvNum ? ` · Invoice ${qbInvNum}` : ""} · ${projectTitle}`.trim();
      filename = `invoice-${qbInvNum || jobId.slice(0, 8)}.pdf`;
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
    if (type === "invoice" && jobId) {
      const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: jobData } = await adminClient.from("jobs").select("type_meta").eq("id", jobId).single();
      qbPaymentLink = jobData?.type_meta?.qb_payment_link || "";
    }

    const portalUrl = type !== "po" ? await getPortalUrl(jobId) : null;
    const vendorPortalUrl = type === "po" && vendor ? await getVendorPortalUrl(vendor) : null;

    // Reply-to with plus-addressing for Gmail poller matching
    let replyTo: string | undefined;
    if (type === "po" && jobId) {
      replyTo = `production+po.${jobId}@housepartydistro.com`;
    } else if (jobId) {
      replyTo = `hello+c.${jobId}@housepartydistro.com`;
    }

    // Send via Resend
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      ...(replyTo ? { replyTo: replyTo } : {}),
      subject: defaultSubject,
      html: type === "quote"
        ? renderBrandedEmail({
            heading: `Quote ${jobNum || ""}`.trim(),
            greeting: `Hi ${clientGreeting},`,
            bodyHtml: `Your quote ${jobNum || ""} is attached for review. When you're ready to move forward, you can approve it directly in your portal, or request changes if anything needs a second pass.`,
            cta: portalUrl ? { label: "Approve Quote", url: portalUrl, style: "dark" } : undefined,
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
          })
        : type === "invoice"
        ? renderBrandedEmail({
            heading: `Invoice${qbInvNum ? ` #${qbInvNum}` : ""}`,
            greeting: `Hi ${clientGreeting},`,
            bodyHtml: qbInvNum && projectTitle
              ? `Your invoice for <strong>Invoice ${qbInvNum} · ${projectTitle}</strong> is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.`
              : `Your invoice${qbInvNum ? ` #${qbInvNum}` : ""} is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.`,
            cta: qbPaymentLink ? { label: "Pay Online", url: qbPaymentLink, style: "green" } : undefined,
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
          })
        : renderBrandedEmail({
            heading: `Purchase order${qbInvNum ? ` ${qbInvNum}` : ""}`,
            greeting: `Hi,`,
            bodyHtml: `Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.`,
            cta: vendorPortalUrl ? { label: "View in Vendor Portal", url: vendorPortalUrl, style: "dark" } : undefined,
            hint: `You can confirm receipt, update production status, and enter tracking directly from the portal.`,
            closing: "Thanks,\nHouse Party Distro",
          }),
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
      // Look up decorator ID for PO emails
      let emailDecId = null;
      if (type === "po" && vendor) {
        const { data: dec2 } = await adminClient.from("decorators").select("id").or(`name.eq.${vendor},short_code.eq.${vendor}`).single();
        emailDecId = dec2?.id || null;
      }
      await adminClient.from("email_messages").insert({
        job_id: jobId,
        direction: "outbound",
        channel: type === "po" ? "production" : "client",
        decorator_id: emailDecId,
        from_email: fromAddress,
        from_name: "House Party Distro",
        to_emails: [recipientEmail],
        cc_emails: ccEmails || [],
        subject: defaultSubject,
        body_text: type === "po"
          ? `Purchase order attached (${filename})\n\nPlease find the attached purchase order. Let us know if you have any questions or need clarification on any items.`
          : type === "quote"
          ? `Quote attached (${filename})\n\nHere's your quote — take a look and let us know if you have any questions or want to make changes.`
          : type === "invoice"
          ? `Invoice attached (${filename})\n\nAttached is your invoice. Let us know if you have any questions.`
          : `${type} attached (${filename})`,
        resend_message_id: data?.id || null,
      });
      // Save sent timestamps for dashboard follow-up tracking
      if (type === "quote" || type === "invoice") {
        const tsKey = type === "quote" ? "quote_sent_at" : "invoice_sent_at";
        const { data: jd } = await adminClient.from("jobs").select("type_meta").eq("id", jobId).single();
        const updateData: any = { type_meta: { ...(jd?.type_meta || {}), [tsKey]: new Date().toISOString() } };
        if (type === "quote") updateData.quote_rejection_notes = null;
        await adminClient.from("jobs").update(updateData).eq("id", jobId);
      }
      // Log activity server-side — works from dashboard, quote tab, anywhere
      const activityMsg =
        type === "quote" ? `Quote sent to client (${recipientEmail})`
        : type === "invoice" ? `Invoice sent to client (${recipientEmail})`
        : type === "po" ? `PO sent to ${vendor || "decorator"} (${recipientEmail})`
        : `Email sent (${type})`;
      await adminClient.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto", message: activityMsg,
      });
    } catch {} // Non-fatal

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}
