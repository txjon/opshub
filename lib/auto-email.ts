/**
 * Server-side auto-email utility.
 * Sends notifications to client contacts without user interaction.
 * Used by: proof upload, payment received, tracking entered, quote approved.
 */
import { createClient } from "@supabase/supabase-js";
import { renderBrandedEmail } from "@/lib/email-template";
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
    | "payment_received";
  itemName?: string;
  trackingNumber?: string;
  carrier?: string;
  amount?: number;
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
      .select("id, title, job_number, type_meta, portal_token, client_id, companies:company_id(slug)")
      .eq("id", params.jobId)
      .single();
    if (!job) return;
    const tenantSlug = ((job as any).companies?.slug || "hpd") as string;
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
    const bodyRef = hasQbInvoice
      ? `<strong>Invoice ${qbInvoiceNum} · ${job.title}</strong>`
      : `<strong>${job.title}</strong>`;

    switch (params.type) {
      case "proof_ready":
        subject = `Proof ready for review — ${clientName}${invoiceSuffix} · ${job.title}`;
        html = renderBrandedEmail({
          heading: "Proof ready for review",
          greeting: `Hi ${clientName},`,
          bodyHtml: `A proof for ${bodyRef} is ready for your review in the portal. Approve when you're good with it, or request changes and we'll send it back for revisions.`,
          cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
        });
        break;

      case "payment_received":
        subject = `Payment received — ${clientName} · Invoice ${invoiceNum} · ${job.title}`;
        html = renderBrandedEmail({
          heading: "Payment received",
          greeting: `Hi ${clientName},`,
          bodyHtml: `Payment${params.amount ? ` of <strong>$${params.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : ""} received for <strong>Invoice ${invoiceNum} · ${job.title}</strong>. Thank you!`,
          cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
        });
        break;
    }

    // Send
    await resend.emails.send({
      from,
      to: primary.email,
      ...(ccEmails.length > 0 ? { cc: ccEmails } : {}),
      subject,
      html,
    });

    // Log activity
    const activityMessages: Record<string, string> = {
      proof_ready: `Auto-email: proof review notification sent to ${primary.email}`,
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
