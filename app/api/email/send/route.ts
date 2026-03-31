export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
      const { data, error } = await resend.emails.send({
        from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
        to: recipientEmail,
        ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
        subject: subject || "File for Review — House Party Distro",
        html: customBody,
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

    // Send via Resend
    const { data, error } = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      subject: defaultSubject,
      html: type === "quote"
        ? `<p>Hi,</p><p>Here's your quote — take a look and let us know if you have any questions or want to make changes.</p><p>Welcome to the party,<br/>House Party Distro</p>`
        : type === "invoice_proofs"
        ? `<p>Hi,</p><p>Attached is your invoice along with print proofs for review. Please take a look at the proofs and let us know if everything looks good or if you'd like any revisions.</p>${payButton}<p>Welcome to the party,<br/>House Party Distro</p>`
        : type === "invoice"
        ? `<p>Hi,</p><p>Attached is your invoice. Let us know if you have any questions.</p>${payButton}<p>Welcome to the party,<br/>House Party Distro</p>`
        : `<p>Hi,</p><p>Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.</p><p>Thanks,<br/>House Party Distro</p>`,
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

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Unknown error" }, { status: 500 });
  }
}
