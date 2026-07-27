/**
 * Server-side auto-email utility.
 * Sends notifications to client contacts without user interaction.
 * Used by: proof upload, payment received, tracking entered, quote approved.
 */
import { createClient } from "@supabase/supabase-js";
import { renderBrandedEmail, tenantClosing } from "@/lib/email-template";
import { appBaseUrl } from "@/lib/public-url";
import { resendForSlug } from "@/lib/resend-client";

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

type NotifyParams = {
  jobId: string;
  type:
    | "proof_ready"
    | "proof_revised"
    | "payment_received";
  itemName?: string;
  trackingNumber?: string;
  carrier?: string;
  amount?: number;
  // Optional overrides (used by the "Send revised proofs" modal):
  recipients?: string[]; // explicit To/CC list — first = To, rest = CC. Falls back to job contacts.
  note?: string;         // custom note appended to the stock body.
};

/**
 * Send an automated email to a project's client contacts.
 * Looks up portal token, contacts, and builds appropriate HTML.
 * Fire-and-forget safe — catches its own errors.
 */
export async function sendClientNotification(params: NotifyParams) {
  try {
    const sb = admin();

    // Get job details + portal token, including the tenant slug so the
    // Resend key + from-address pick the right brand.
    const { data: job } = await sb
      .from("jobs")
      .select("id, title, job_number, type_meta, portal_token, client_id, companies:company_id(slug, name)")
      .eq("id", params.jobId)
      .single();
    if (!job) return;
    const tenantSlug = ((job as any).companies?.slug || "hpd") as string;
    const tenantName = ((job as any).companies?.name || "House Party Distro") as string;
    const resend = resendForSlug(tenantSlug);

    // Get client name
    let clientName = "Client";
    if (job.client_id) {
      const { data: client } = await sb
        .from("clients")
        .select("name")
        .eq("id", job.client_id)
        .single();
      if (client) clientName = client.name;
    }

    // Get job contacts (primary + billing + cc)
    const { data: jobContacts } = await sb
      .from("job_contacts")
      .select("contact_id, role_on_job")
      .eq("job_id", job.id);
    if (!jobContacts?.length) {
      console.warn(`[Auto-email] No contacts on job ${job.id} — skipping ${params.type} notification`);
      await sb.from("job_activity").insert({ job_id: job.id, user_id: null, type: "auto", message: `Auto-email skipped (${params.type}): no contacts on project` });
      return;
    }

    const contactIds = jobContacts.map((jc: any) => jc.contact_id);
    const { data: contacts } = await sb
      .from("contacts")
      .select("id, name, email")
      .in("id", contactIds);
    if (!contacts?.length) return;

    // Primary gets the email, others get CC
    const primaryContactId = jobContacts.find(
      (jc: any) => jc.role_on_job === "primary"
    )?.contact_id;
    const primary = contacts.find((c: any) => c.id === primaryContactId) || contacts[0];
    if (!primary?.email) {
      console.warn(`[Auto-email] Primary contact has no email on job ${job.id} — skipping ${params.type}`);
      await sb.from("job_activity").insert({ job_id: job.id, user_id: null, type: "auto", message: `Auto-email skipped (${params.type}): primary contact has no email` });
      return;
    }

    const ccEmails = contacts
      .filter((c: any) => c.id !== primary.id && c.email)
      .map((c: any) => c.email);

    // Build portal URL
    const baseUrl = await appBaseUrl();
    const portalUrl = job.portal_token
      ? `${baseUrl}/portal/${job.portal_token}`
      : null;

    // Build email content based on type
    let subject = "";
    let html = "";
    const from = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
    // Prefer QB invoice # when available; fall back to job number for pre-invoice sends.
    const qbInvoiceNum = (job as any).type_meta?.qb_invoice_number || "";
    const hasQbInvoice = !!qbInvoiceNum;
    const invoiceNum = qbInvoiceNum || job.job_number || "";
    const invoiceSuffix = hasQbInvoice ? ` · Invoice ${qbInvoiceNum}` : "";
    // Client-safe order reference: invoice number when it exists, else the job
    // number. The job memo/title is INTERNAL and never reaches clients.
    const bodyRef = hasQbInvoice
      ? `<strong>Invoice ${qbInvoiceNum}</strong>`
      : `<strong>order ${job.job_number || ""}</strong>`;

    switch (params.type) {
      case "proof_ready":
        subject = `Proof ready for review · ${clientName}${invoiceSuffix}`;
        html = renderBrandedEmail({
          eyebrow: tenantName,
          heading: "Proof ready for review",
          greeting: `Hi ${clientName},`,
          bodyHtml: `A proof for ${bodyRef} is ready for your review in the portal. Approve when you're good with it, or request changes and we'll send it back for revisions.`,
          cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
          closing: tenantClosing(tenantSlug, tenantName),
        });
        break;

      case "proof_revised": {
        const noteBlock = params.note && params.note.trim()
          ? `<div style="margin:16px 0;padding:14px 16px;background:#f7f7f7;border-left:3px solid #222;border-radius:4px;font-size:14px;color:#333;line-height:1.55;white-space:pre-wrap;">${params.note.trim().replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] || c))}</div>`
          : "";
        subject = `Revised proof ready · ${clientName}${invoiceSuffix}`;
        html = renderBrandedEmail({
          eyebrow: tenantName,
          heading: "Revised proof ready for review",
          greeting: `Hi ${clientName},`,
          bodyHtml: `We've made the changes you requested: an updated proof for ${bodyRef} is ready for another look in the portal. Approve when it's good, or request further changes.${noteBlock}`,
          cta: portalUrl ? { label: "Review revised proof", url: portalUrl, style: "outline" } : undefined,
          closing: tenantClosing(tenantSlug, tenantName),
        });
        break;
      }

      case "payment_received":
        subject = `Payment received · ${clientName} · Invoice ${invoiceNum}`;
        html = renderBrandedEmail({
          eyebrow: tenantName,
          heading: "Payment received",
          greeting: `Hi ${clientName},`,
          bodyHtml: `Payment${params.amount ? ` of <strong>$${params.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : ""} received for <strong>Invoice ${invoiceNum}</strong>. Thank you!`,
          cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
          closing: `Thanks,\n${tenantName}`,
        });
        break;
    }

    // Recipients — explicit override (from the send modal) wins; else the
    // job's primary contact (To) + remaining contacts (CC).
    const override = (params.recipients || []).filter(Boolean);
    const toEmail = override.length > 0 ? override[0] : primary.email;
    const ccList = override.length > 0 ? override.slice(1) : ccEmails;

    // Job-thread reply-to — same plus-addressing as /api/email/send's client
    // sends (hello+c.<jobId>@domain) so replies to proof/payment emails land
    // in the job-specific thread, not the bare inbox.
    const fromEmail = (from.match(/<([^>]+)>/)?.[1] || from).trim();
    const replyTo = `${fromEmail.split("@")[0] || "hello"}+c.${job.id}@${fromEmail.split("@")[1] || "housepartydistro.com"}`;

    // Send
    await resend.emails.send({
      from,
      to: toEmail,
      ...(ccList.length > 0 ? { cc: ccList } : {}),
      subject,
      html,
      replyTo,
    });

    // Log activity
    const activityMessages: Record<string, string> = {
      proof_ready: `Auto-email: proof review notification sent to ${primary.email}`,
      proof_revised: `Auto-email: revised proof notification sent to ${toEmail}`,
      payment_received: `Auto-email: payment confirmation sent to ${primary.email}`,
    };

    await sb.from("job_activity").insert({
      job_id: job.id,
      user_id: null,
      type: "auto",
      message: activityMessages[params.type] || `Auto-email sent to ${primary.email}`,
    });
  } catch (err) {
    console.error("Auto-email error:", err);
    // Non-fatal — don't crash the caller
  }
}

/**
 * Get the portal URL for a job. Used by email routes to append portal link.
 *
 * Clients with `clients.client_hub_enabled = true` get the Client Hub
 * per-order URL (the new tabbed hub with fulfillment, staging, designs,
 * etc.); everyone else keeps the legacy /portal/{job_token} link. When
 * you flip a client to Client Hub, their subsequent emails route there
 * automatically — no per-email config needed.
 */
export async function getPortalUrl(jobId: string): Promise<string | null> {
  try {
    const sb = admin();
    const { data: job } = await sb
      .from("jobs")
      .select("id, portal_token, client_id, clients(portal_token, client_hub_enabled)")
      .eq("id", jobId)
      .single();
    if (!job) return null;

    const client = (job as any).clients;
    const baseUrl = await appBaseUrl();

    if (client?.client_hub_enabled && client?.portal_token) {
      return `${baseUrl}/portal/client/${client.portal_token}/orders/${job.id}`;
    }
    if (!job.portal_token) return null;
    return `${baseUrl}/portal/${job.portal_token}`;
  } catch {
    return null;
  }
}

/**
 * Get the vendor portal URL for a decorator. Used by PO email to include portal link.
 */
export async function getVendorPortalUrl(vendorName: string): Promise<string | null> {
  try {
    const sb = admin();
    // Look up decorator by name or short_code
    const { data: dec } = await sb
      .from("decorators")
      .select("external_token")
      .or(`name.eq.${vendorName},short_code.eq.${vendorName}`)
      .single();
    if (!dec?.external_token) return null;

    const baseUrl = await appBaseUrl();
    return `${baseUrl}/portal/vendor/${dec.external_token}`;
  } catch {
    return null;
  }
}
