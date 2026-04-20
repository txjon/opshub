export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendClientNotification } from "@/lib/auto-email";

// Central auto-email trigger. Used by server routes and client components that
// can't call sendClientNotification directly.
//
// Shipping emails (order_shipped_vendor, order_shipped_hpd, order_shipped_stage,
// invoice_revised) are handled inline here — they need to attach PDFs that
// require server-side fetching. Other client emails (proof_ready, payment_received)
// delegate to sendClientNotification in lib/auto-email.ts.
//
// Idempotency: shipping emails write an entry to jobs.type_meta.shipping_notifications
// before sending. If an equivalent entry already exists (same type + decoratorId +
// tracking), the call is skipped unless `resend: true` is set. UI uses this array
// to display "already notified" state and offer a Resend button.

type ShipNotificationRecord = {
  type: "drop_ship_vendor" | "ship_through" | "stage";
  decoratorId: string | null;
  decoratorName: string | null;
  sentAt: string;
  recipients: string[];
  tracking: string | null;
  resend: boolean;
};

const BASE_URL = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

const FROM_ADDR = () => process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

async function loadJobAndClientEmail(sb: any, jobId: string) {
  const { data: job } = await sb.from("jobs").select("*, clients(name)").eq("id", jobId).single();
  if (!job) return { job: null, clientEmail: null, clientName: "" };

  const { data: contacts } = await sb
    .from("job_contacts")
    .select("role_on_job, contacts(email, name)")
    .eq("job_id", jobId);
  const billing = (contacts as any)?.find((c: any) => c.role_on_job === "billing")?.contacts;
  const primary = (contacts as any)?.find((c: any) => c.role_on_job === "primary")?.contacts;
  const anyContact = (contacts as any)?.map((c: any) => c.contacts).find((c: any) => c?.email);
  const clientEmail: string | null = billing?.email || primary?.email || anyContact?.email || null;
  const clientNameFromContact: string = billing?.name || primary?.name || anyContact?.name || "";
  return { job, clientEmail, clientName: (job as any).clients?.name || "", firstName: clientNameFromContact.split(" ")[0] || "" };
}

function portalButton(portalUrl: string | null) {
  if (!portalUrl) return "";
  return `<p style="margin:16px 0"><a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">View in Portal</a></p>`;
}

async function fetchPdf(url: string) {
  const res = await fetch(url, { headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! } });
  if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

// Idempotency check: does a matching shipment notification already exist?
function alreadySent(records: ShipNotificationRecord[], type: string, decoratorId: string | null, tracking: string | null) {
  return records.some(r =>
    r.type === type &&
    (r.decoratorId || null) === (decoratorId || null) &&
    (r.tracking || null) === (tracking || null)
  );
}

export async function POST(req: NextRequest) {
  try {
    // Allow either a logged-in user OR an internal service-role call
    const internal = req.headers.get("x-internal-key") === process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!internal) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId, type, trackingNumber, carrier, decoratorId, vendorName, resend: forceResend } = await req.json();
    if (!jobId || !type) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { createClient: createAdmin } = await import("@supabase/supabase-js");
    const { Resend } = await import("resend");
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const resend = new Resend(process.env.RESEND_API_KEY);

    // ── Shipping emails — inline handlers with PDF attachments ─────────────────
    if (type === "order_shipped_vendor" || type === "order_shipped_hpd" || type === "order_shipped_stage") {
      const { job, clientEmail, clientName } = await loadJobAndClientEmail(sb, jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      // Idempotency check
      const typeMeta = ((job as any).type_meta || {}) as any;
      const existing: ShipNotificationRecord[] = Array.isArray(typeMeta.shipping_notifications)
        ? typeMeta.shipping_notifications
        : [];
      const recordType: ShipNotificationRecord["type"] =
        type === "order_shipped_vendor" ? "drop_ship_vendor" :
        type === "order_shipped_hpd" ? "ship_through" : "stage";

      if (!forceResend && alreadySent(existing, recordType, decoratorId || null, trackingNumber || null)) {
        return NextResponse.json({ success: true, skipped: "already_sent" });
      }

      const invoiceNum = typeMeta.qb_invoice_number || (job as any).job_number || "";
      const portalToken = (job as any).portal_token;
      const portalUrl = portalToken ? `${BASE_URL()}/portal/${portalToken}` : null;
      const projectTitle = (job as any).title || "your order";
      const trackingLine = trackingNumber
        ? `<p>Tracking: <strong>${trackingNumber}</strong>${carrier ? ` · ${carrier}` : ""}</p>`
        : "";

      let subject = "";
      let html = "";
      let pdfFilename = "";

      if (type === "order_shipped_vendor") {
        // Drop-ship per-vendor shipment — Jon's locked copy
        subject = `Part of your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        html =
          `<p>Hi ${clientName || "there"},</p>` +
          `<p>Part of your order for Invoice ${invoiceNum} · ${projectTitle} has shipped, packing slip attached.</p>` +
          trackingLine +
          portalButton(portalUrl) +
          `<p>Welcome to the party!<br/>House Party Distro</p>`;
        pdfFilename = `HPD-PackingSlip-${invoiceNum}${vendorName ? `-${vendorName.replace(/[^a-z0-9]/gi, "")}` : ""}.pdf`;
      } else {
        // Ship-through and stage — Jon's locked copy (same for both routes)
        subject = `Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        html =
          `<p>Hi ${clientName || "there"},</p>` +
          `<p>Your order for ${projectTitle} has shipped from House Party Distro. The packing slip is attached.</p>` +
          trackingLine +
          portalButton(portalUrl) +
          `<p>Welcome to the party!<br/>House Party Distro</p>`;
        pdfFilename = `HPD-PackingSlip-${invoiceNum}.pdf`;
      }

      let pdfBuffer: Buffer;
      try {
        const slipUrl = `${BASE_URL()}/api/pdf/packing-slip/${jobId}${decoratorId ? `?decoratorId=${decoratorId}` : ""}`;
        pdfBuffer = await fetchPdf(slipUrl);
      } catch (e: any) {
        console.error(`[notify/${type}] packing slip fetch failed:`, e.message);
        return NextResponse.json({ error: "Packing slip generation failed" }, { status: 500 });
      }

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject,
        html,
        attachments: [{ filename: pdfFilename, content: pdfBuffer.toString("base64") }],
      });

      // Record the send for idempotency + sent-state UI
      const newRecord: ShipNotificationRecord = {
        type: recordType,
        decoratorId: decoratorId || null,
        decoratorName: vendorName || null,
        sentAt: new Date().toISOString(),
        recipients: [clientEmail],
        tracking: trackingNumber || null,
        resend: !!forceResend,
      };
      await sb
        .from("jobs")
        .update({ type_meta: { ...typeMeta, shipping_notifications: [...existing, newRecord] } })
        .eq("id", jobId);

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: forceResend
          ? `Resent shipment email to ${clientEmail} (${recordType}${vendorName ? ` · ${vendorName}` : ""})`
          : `Auto-email: shipment notification sent to ${clientEmail} (${recordType}${vendorName ? ` · ${vendorName}` : ""})`,
      });

      return NextResponse.json({ success: true, record: newRecord });
    }

    // ── Revised invoice — Jon's locked copy ─────────────────────────────────────
    if (type === "invoice_revised") {
      const { job, clientEmail, clientName } = await loadJobAndClientEmail(sb, jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await fetchPdf(`${BASE_URL()}/api/pdf/invoice/${jobId}`);
      } catch {
        return NextResponse.json({ error: "PDF generation failed" }, { status: 500 });
      }

      const typeMeta = ((job as any).type_meta || {}) as any;
      const invoiceNum = typeMeta.qb_invoice_number || (job as any).job_number || "";
      const qbPaymentLink = typeMeta.qb_payment_link || "";
      const portalToken = (job as any).portal_token;
      const portalUrl = portalToken ? `${BASE_URL()}/portal/${portalToken}` : null;
      const projectTitle = (job as any).title || "";
      const payButton = qbPaymentLink
        ? `<a href="${qbPaymentLink}" style="display:inline-block;padding:12px 28px;background:#34c97a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">Pay Online</a>`
        : "";
      const portalLinkInline = portalUrl
        ? `<a href="${portalUrl}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">View in Portal</a>`
        : "";

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject: `Revised invoice ${invoiceNum} — ${clientName} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName || "there"},</p>` +
          `<p>Your invoice ${invoiceNum} has been updated with final shipped quantities. The revised copy is attached and waiting in your portal.</p>` +
          `<p style="margin:20px 0;display:flex;gap:10px">${payButton} ${portalLinkInline}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>`,
        attachments: [{ filename: `HPD-Invoice-${invoiceNum}-Revised.pdf`, content: pdfBuffer.toString("base64") }],
      });

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: `Revised invoice ${invoiceNum} sent to client (${clientEmail})`,
      });

      return NextResponse.json({ success: true });
    }

    // Fallback: delegate to auto-email.ts (proof_ready, payment_received)
    await sendClientNotification({ jobId, type, trackingNumber, carrier });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
