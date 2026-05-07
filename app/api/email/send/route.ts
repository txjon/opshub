export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getPortalUrl, getVendorPortalUrl } from "@/lib/auto-email";
import { renderBrandedEmail, tenantClosing } from "@/lib/email-template";
import { refreshPaymentLink } from "@/lib/quickbooks";
import { resendForSlug } from "@/lib/resend-client";

// Resolve active tenant from request Host (middleware doesn't run on
// /api/* routes). Used to pick which company's from-addresses + name
// the email gets sent with.
function resolveCompanySlugFromRequest(req: NextRequest): string {
  const h = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export async function POST(req: NextRequest) {
  try {
    // Auth check — only logged-in users can send emails
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { type, jobId, vendor, recipientEmail, ccEmails, recipientName, subject, customBody, rfqItemIds } = await req.json();

    // Pull the active tenant's branding (name + from-addresses) so emails
    // ship as "In House Merchandise <info@inhousemerchandise.com>" on
    // app.inhousemerchandise.com and "House Party Distro <hello@...>"
    // on HPD's URL. The Resend API key is also slug-scoped — each
    // tenant has its own restricted key for its verified domain.
    const slug = resolveCompanySlugFromRequest(req);
    const resend = resendForSlug(slug);
    const adminForCompany = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: companyRow } = await adminForCompany.from("companies")
      .select("name, from_email_quotes, from_email_production, from_email_billing, default_payment_provider")
      .eq("slug", slug)
      .single();
    const company = (companyRow as any) || {};
    const companyName: string = company.name || "House Party Distro";
    const tenantPaymentProvider: string = company.default_payment_provider || "quickbooks";
    const fromQuotes: string = company.from_email_quotes || process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
    const fromProduction: string = company.from_email_production || process.env.EMAIL_FROM_PO || "onboarding@resend.dev";
    // Domain used for plus-addressing reply-to (production+po.JOB@domain)
    const emailDomain = (fromQuotes.split("@")[1] || "housepartydistro.com");
    // Local part of the client-facing inbox — drives reply-to for
    // non-PO/RFQ emails (so client replies route back through the same
    // address Resend's inbound capture is watching).
    const clientLocalPart = (fromQuotes.split("@")[0] || "hello");
    const productionLocalPart = (fromProduction.split("@")[0] || "production");

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

    // Load job for document numbers + client name (for greeting). Also
    // pull portal_token so we can build the white-label Stripe pay URL
    // (/portal/{token}/pay) for tenants on the Stripe payment provider.
    const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: jobData } = await adminClient.from("jobs").select("job_number, title, type_meta, portal_token, clients(name)").eq("id", jobId).single();
    const qbInvNum = (jobData as any)?.type_meta?.qb_invoice_number;
    const jobNum = (jobData as any)?.job_number;
    const projectTitle = (jobData as any)?.title || "";
    const clientGreeting = (jobData as any)?.clients?.name || (recipientName ? recipientName.split(" ")[0] : "there");

    // Wrap the bare email in "Company Name <addr>" so client inboxes
    // show the friendly name instead of just the local part.
    const namedFrom = (addr: string) => `${companyName} <${addr}>`;
    // PO# prefix derives from company name initials so HPD prints
    // "HPD PO#" and IHM prints "IHM PO#" without us hardcoding either.
    const poPrefix = companyName.split(/\s+/).filter(Boolean).map(w => w[0]?.toUpperCase() || "").join("") + " PO";

    if (type === "quote") {
      pdfUrl = `${baseUrl}/api/pdf/quote/${jobId}`;
      fromAddress = namedFrom(fromQuotes);
      defaultSubject = subject || `Quote ${jobNum || ""} — ${companyName}`.trim();
      filename = `quote-${jobNum || jobId.slice(0, 8)}.pdf`;
    } else if (type === "po") {
      pdfUrl = `${baseUrl}/api/pdf/po/${jobId}?download=1${vendor ? `&vendor=${encodeURIComponent(vendor)}` : ""}`;
      fromAddress = namedFrom(fromProduction);
      defaultSubject = subject || `${poPrefix}# ${qbInvNum || jobNum || ""} — ${companyName}`.trim();
      filename = `po-${qbInvNum || jobNum || jobId.slice(0, 8)}.pdf`;
    } else if (type === "invoice") {
      pdfUrl = `${baseUrl}/api/pdf/invoice/${jobId}?download=1`;
      fromAddress = namedFrom(company.from_email_billing || fromQuotes);
      const clientName = (jobData as any)?.clients?.name || "";
      const isRevisedInvoice = !!(jobData as any)?.type_meta?.invoice_sent_at;
      const invoiceLabel = isRevisedInvoice ? "Revised invoice" : "Invoice";
      defaultSubject = subject || `${invoiceLabel} — ${clientName}${qbInvNum ? ` · Invoice ${qbInvNum}` : ""} · ${projectTitle}`.trim();
      filename = `invoice-${qbInvNum || jobId.slice(0, 8)}${isRevisedInvoice ? "-revised" : ""}.pdf`;
    } else if (type === "rfq") {
      const itemsQs = Array.isArray(rfqItemIds) && rfqItemIds.length > 0 ? `&items=${encodeURIComponent(rfqItemIds.join(","))}` : "";
      pdfUrl = `${baseUrl}/api/pdf/rfq/${jobId}?download=1${vendor ? `&vendor=${encodeURIComponent(vendor)}` : ""}${itemsQs}`;
      fromAddress = namedFrom(fromProduction);
      defaultSubject = subject || `Quote request — ${jobNum || ""} — ${projectTitle || ""}`.trim();
      filename = `rfq-${jobNum || jobId.slice(0, 8)}.pdf`;
    } else {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    // Generate the PDF by calling our own endpoint. Pass the secret key
    // for auth and x-company-slug so the PDF route resolves the correct
    // tenant for branding (logo, addresses, from-emails). Without the
    // slug header the route falls back to the request Host, which is
    // the shared opshub-umber.vercel.app URL when called internally —
    // it would render HPD's brand on IHM PDFs.
    const pdfRes = await fetch(pdfUrl, {
      headers: {
        "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "",
        "x-company-slug": slug,
      },
    });
    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      return NextResponse.json({ error: `PDF generation failed: ${text}` }, { status: 500 });
    }

    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    // Get QB payment link. If missing or the stale admin URL, ask QB to mint
    // a fresh customer-facing one before sending — otherwise the email ships
    // with no "Pay online" button.
    let qbPaymentLink = "";
    if (type === "invoice" && jobId) {
      const adminClient = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
      const { data: jobData } = await adminClient.from("jobs").select("type_meta").eq("id", jobId).single();
      qbPaymentLink = jobData?.type_meta?.qb_payment_link || "";
      const invoiceId = (jobData?.type_meta as any)?.qb_invoice_id;
      const isLegacy = qbPaymentLink.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
      if (invoiceId && (!qbPaymentLink || isLegacy)) {
        try {
          const fresh = await refreshPaymentLink(String(invoiceId), recipientEmail);
          if (fresh && fresh !== qbPaymentLink) {
            qbPaymentLink = fresh;
            await adminClient.from("jobs").update({
              type_meta: { ...(jobData?.type_meta || {}), qb_payment_link: fresh },
            }).eq("id", jobId);
          }
        } catch (e) {
          console.error("[email/send] refreshPaymentLink failed:", (e as any).message);
        }
      }
    }

    const portalUrl = type !== "po" && type !== "rfq" ? await getPortalUrl(jobId) : null;
    const vendorPortalUrl = type === "po" && vendor ? await getVendorPortalUrl(vendor) : null;

    // Unified "Pay Online" link for invoice emails. QB tenants point at
    // QB's hosted invoice page (qbPaymentLink). Stripe tenants point at
    // our white-label pay page (/portal/{token}/pay) so the client never
    // sees stripe.com — Payment Element renders inline on our domain.
    let payOnlineUrl: string = "";
    if (type === "invoice") {
      if (tenantPaymentProvider === "stripe") {
        const portalToken = (jobData as any)?.portal_token;
        const stripeInvoiceId = (jobData as any)?.type_meta?.stripe_invoice_id;
        if (portalToken && stripeInvoiceId) {
          const { appBaseUrl } = await import("@/lib/public-url");
          payOnlineUrl = `${await appBaseUrl()}/portal/${portalToken}/pay`;
        }
      } else {
        payOnlineUrl = qbPaymentLink || "";
      }
    }

    // Reply-to with plus-addressing for Gmail poller matching. Domain +
    // local part are derived from the active tenant's from-addresses
    // so IHM replies route to info+c.JOB@inhousemerchandise.com and
    // HPD's stay on housepartydistro.com.
    let replyTo: string | undefined;
    if (type === "po" && jobId) {
      replyTo = `${productionLocalPart}+po.${jobId}@${emailDomain}`;
    } else if (type === "rfq" && jobId) {
      replyTo = `${productionLocalPart}+rfq.${jobId}@${emailDomain}`;
    } else if (jobId) {
      replyTo = `${clientLocalPart}+c.${jobId}@${emailDomain}`;
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
            eyebrow: companyName,
            heading: `Quote ${jobNum || ""}`.trim(),
            greeting: `Hi ${clientGreeting},`,
            bodyHtml: `Your quote ${jobNum || ""} is attached for review. When you're ready to move forward, you can approve it directly in your portal, or request changes if anything needs a second pass.`,
            cta: portalUrl ? { label: "Approve Quote", url: portalUrl, style: "dark" } : undefined,
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
            closing: tenantClosing(slug, companyName),
          })
        : type === "invoice"
        ? (() => {
            const isRevised = !!(jobData as any)?.type_meta?.invoice_sent_at;
            const invoiceWord = isRevised ? "revised invoice" : "invoice";
            const headingWord = isRevised ? "Revised invoice" : "Invoice";
            return renderBrandedEmail({
              eyebrow: companyName,
              heading: `${headingWord}${qbInvNum ? ` #${qbInvNum}` : ""}`,
              greeting: `Hi ${clientGreeting},`,
              bodyHtml: qbInvNum && projectTitle
                ? `Your ${invoiceWord} for <strong>Invoice ${qbInvNum} · ${projectTitle}</strong> is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.`
                : `Your ${invoiceWord}${qbInvNum ? ` #${qbInvNum}` : ""} is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.`,
              cta: payOnlineUrl ? { label: "Pay Online", url: payOnlineUrl, style: "green" } : undefined,
              secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
              closing: `Thanks,\n${companyName}`,
            });
          })()
        : type === "rfq"
        ? (() => {
            const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            const customExtra = customBody && customBody.trim()
              ? `<div style="margin:16px 0;padding:14px 16px;background:#f7f7f7;border-left:3px solid #222;border-radius:4px;font-size:14px;color:#333;line-height:1.55;">${escapeHtml(customBody.trim()).replace(/\n/g, "<br/>")}</div>`
              : "";
            return renderBrandedEmail({
              eyebrow: companyName,
              heading: `Quote request — ${jobNum || ""}`.trim(),
              greeting: `Hi ${vendor || "there"},`,
              bodyHtml: `Can you please provide pricing for the item(s) in the attachment? The PDF lays out each item — please reply with: pricing, setup fees, and estimated shipping cost. In addition, we need realistic production lead time and post-production transit time.`,
              extraHtml: customExtra,
              hint: `Reach out if anything in the spec is unclear or if you need additional info — we'll send through whatever you need.`,
              closing: `Thanks,\n${companyName}`,
              align: "left",
            });
          })()
        : renderBrandedEmail({
            eyebrow: companyName,
            heading: `Purchase order${qbInvNum ? ` ${qbInvNum}` : ""}`,
            greeting: `Hi ${vendor || "there"},`,
            bodyHtml: `Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.`,
            cta: vendorPortalUrl ? { label: "View in Vendor Portal", url: vendorPortalUrl, style: "dark" } : undefined,
            hint: `You can confirm receipt, update production status, and enter tracking directly from the portal.`,
            closing: `Thanks,\n${companyName}`,
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
      // Look up decorator ID for PO/RFQ emails
      let emailDecId = null;
      if ((type === "po" || type === "rfq") && vendor) {
        const { data: dec2 } = await adminClient.from("decorators").select("id").or(`name.eq.${vendor},short_code.eq.${vendor}`).single();
        emailDecId = dec2?.id || null;
      }
      await adminClient.from("email_messages").insert({
        job_id: jobId,
        direction: "outbound",
        channel: (type === "po" || type === "rfq") ? "production" : "client",
        decorator_id: emailDecId,
        from_email: fromAddress,
        from_name: companyName,
        to_emails: [recipientEmail],
        cc_emails: ccEmails || [],
        subject: defaultSubject,
        body_text: type === "po"
          ? `Purchase order attached (${filename})\n\nPlease find the attached purchase order. Let us know if you have any questions or need clarification on any items.`
          : type === "rfq"
          ? `Quote request attached (${filename})\n\nWe'd love a quote on the attached items — please reply with pricing, setup fees, and lead time.`
          : type === "quote"
          ? `Quote attached (${filename})\n\nHere's your quote — take a look and let us know if you have any questions or want to make changes.`
          : type === "invoice"
          ? `${(jobData as any)?.type_meta?.invoice_sent_at ? "Revised invoice" : "Invoice"} attached (${filename})\n\nAttached is your ${(jobData as any)?.type_meta?.invoice_sent_at ? "revised invoice" : "invoice"}. Let us know if you have any questions.`
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
      // RFQ history — append to type_meta.rfq_history so the Costing tab
      // can show "RFQ sent to X · Y days ago" badges next to affected items.
      if (type === "rfq" && vendor) {
        const { data: jd } = await adminClient.from("jobs").select("type_meta").eq("id", jobId).single();
        const prevHistory = ((jd?.type_meta as any)?.rfq_history || []) as any[];
        const entry = {
          vendor,
          item_ids: Array.isArray(rfqItemIds) ? rfqItemIds : [],
          recipient: recipientEmail,
          cc: ccEmails || [],
          sent_at: new Date().toISOString(),
        };
        const newMeta = { ...(jd?.type_meta || {}), rfq_history: [...prevHistory, entry] };
        await adminClient.from("jobs").update({ type_meta: newMeta }).eq("id", jobId);
      }
      // Log activity server-side — works from dashboard, quote tab, anywhere
      const activityMsg =
        type === "quote" ? `Quote sent to client (${recipientEmail})`
        : type === "invoice" ? `${(jobData as any)?.type_meta?.invoice_sent_at ? "Revised invoice" : "Invoice"} sent to client (${recipientEmail})`
        : type === "po" ? `PO sent to ${vendor || "decorator"} (${recipientEmail})`
        : type === "rfq" ? `Quote request sent to ${vendor || "decorator"} (${recipientEmail}${Array.isArray(rfqItemIds) && rfqItemIds.length ? ` · ${rfqItemIds.length} item${rfqItemIds.length !== 1 ? "s" : ""}` : ""})`
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
