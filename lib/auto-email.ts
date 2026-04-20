/**
 * Server-side auto-email utility.
 * Sends notifications to client contacts without user interaction.
 * Used by: proof upload, payment received, tracking entered, quote approved.
 */
import { Resend } from "resend";
import { createClient } from "@supabase/supabase-js";

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
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Get job details + portal token
    const { data: job } = await sb
      .from("jobs")
      .select("id, title, job_number, type_meta, portal_token, client_id")
      .eq("id", params.jobId)
      .single();
    if (!job) return;

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
    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const portalUrl = job.portal_token
      ? `${baseUrl}/portal/${job.portal_token}`
      : null;
    const portalButton = portalUrl
      ? `<p style="margin:20px 0"><a href="${portalUrl}" style="display:inline-block;padding:12px 28px;background:#4361ee;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">View Project Portal</a></p>`
      : "";

    // Build email content based on type
    let subject = "";
    let html = "";
    const from = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
    const displayNum = (job as any).type_meta?.qb_invoice_number || job.job_number;
    const projectRef = `${job.title}${displayNum ? ` (${displayNum})` : ""}`;

    switch (params.type) {
      case "proof_ready":
        subject = `Proof ready for review — ${clientName} · ${job.title}`;
        html = `<p>Hi ${clientName},</p>
<p>A proof is ready for your review in the portal. Approve when you're good with it, or request changes and we'll send it back for revisions.</p>
${portalButton}
<p>Welcome to the party,<br/>House Party Distro</p>`;
        break;

      case "payment_received":
        subject = `Payment received — ${clientName} · ${job.title}`;
        html = `<p>Hi ${clientName},</p>
<p>Payment${params.amount ? ` of <strong>$${params.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</strong>` : ""} received for ${job.title}. Appreciate you.</p>
${portalButton}
<p>Welcome to the party,<br/>House Party Distro</p>`;
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
 */
export async function getPortalUrl(jobId: string): Promise<string | null> {
  try {
    const sb = admin();
    const { data: job } = await sb
      .from("jobs")
      .select("portal_token")
      .eq("id", jobId)
      .single();
    if (!job?.portal_token) return null;

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
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

    const baseUrl =
      process.env.NEXT_PUBLIC_SITE_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    return `${baseUrl}/portal/vendor/${dec.external_token}`;
  } catch {
    return null;
  }
}
