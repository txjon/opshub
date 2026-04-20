export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendClientNotification } from "@/lib/auto-email";
import { renderBrandedEmail, trackingBlock } from "@/lib/email-template";

// Central auto-email trigger. Shipping + invoice-revised + production-complete
// emails render inline (they need PDFs / job data). Other client emails
// (proof_ready, payment_received) delegate to sendClientNotification.
//
// Idempotency: shipping + production_complete emails write to
// jobs.type_meta.shipping_notifications[] and skip if an equivalent entry
// exists unless { resend: true }.

type ShipNotificationRecord = {
  type: "drop_ship_vendor" | "ship_through" | "stage_production_complete";
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
  return { job, clientEmail, clientName: (job as any).clients?.name || "" };
}

async function fetchPdf(url: string) {
  const res = await fetch(url, { headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! } });
  if (!res.ok) throw new Error(`PDF fetch ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

function alreadySent(records: ShipNotificationRecord[], type: string, decoratorId: string | null, tracking: string | null) {
  return records.some(r =>
    r.type === type &&
    (r.decoratorId || null) === (decoratorId || null) &&
    (r.tracking || null) === (tracking || null)
  );
}

export async function POST(req: NextRequest) {
  try {
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

    // ── Shipping emails (drop-ship + ship-through) ─────────────────────────────
    if (type === "order_shipped_vendor" || type === "order_shipped_hpd") {
      const { job, clientEmail, clientName } = await loadJobAndClientEmail(sb, jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      const typeMeta = ((job as any).type_meta || {}) as any;
      const existing: ShipNotificationRecord[] = Array.isArray(typeMeta.shipping_notifications)
        ? typeMeta.shipping_notifications
        : [];
      const recordType: ShipNotificationRecord["type"] =
        type === "order_shipped_vendor" ? "drop_ship_vendor" : "ship_through";

      if (!forceResend && alreadySent(existing, recordType, decoratorId || null, trackingNumber || null)) {
        return NextResponse.json({ success: true, skipped: "already_sent" });
      }

      const invoiceNum = typeMeta.qb_invoice_number || (job as any).job_number || "";
      const portalToken = (job as any).portal_token;
      const portalUrl = portalToken ? `${BASE_URL()}/portal/${portalToken}` : null;
      const projectTitle = (job as any).title || "your order";

      let subject = "";
      let heading = "";
      let bodyHtml = "";
      let pdfFilename = "";

      if (type === "order_shipped_vendor") {
        subject = `Part of your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        heading = "Part of your order has shipped";
        bodyHtml = `Part of your order for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> has shipped. The packing slip is attached.`;
        pdfFilename = `HPD-PackingSlip-${invoiceNum}${vendorName ? `-${vendorName.replace(/[^a-z0-9]/gi, "")}` : ""}.pdf`;
      } else {
        subject = `Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        heading = "Your order has shipped";
        bodyHtml = `Your order for <strong>${projectTitle}</strong> has shipped. The packing slip is attached.`;
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

      const html = renderBrandedEmail({
        heading,
        greeting: `Hi ${clientName || "there"},`,
        bodyHtml,
        extraHtml: trackingBlock(trackingNumber || null, carrier || null),
        cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
        closing: "Welcome to the party!\nHouse Party Distro",
      });

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject,
        html,
        attachments: [{ filename: pdfFilename, content: pdfBuffer.toString("base64") }],
      });

      const newRecord: ShipNotificationRecord = {
        type: recordType,
        decoratorId: decoratorId || null,
        decoratorName: vendorName || null,
        sentAt: new Date().toISOString(),
        recipients: [clientEmail],
        tracking: trackingNumber || null,
        resend: !!forceResend,
      };
      await sb.from("jobs").update({ type_meta: { ...typeMeta, shipping_notifications: [...existing, newRecord] } }).eq("id", jobId);

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: forceResend
          ? `Resent shipment email to ${clientEmail} (${recordType}${vendorName ? ` · ${vendorName}` : ""})`
          : `Auto-email: shipment notification sent to ${clientEmail} (${recordType}${vendorName ? ` · ${vendorName}` : ""})`,
      });

      return NextResponse.json({ success: true, record: newRecord });
    }

    // ── Production complete — stage route, all items received at HPD ───────────
    if (type === "production_complete") {
      const { job, clientEmail, clientName } = await loadJobAndClientEmail(sb, jobId);
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      if (!clientEmail) return NextResponse.json({ success: true, skipped: "no email" });

      const typeMeta = ((job as any).type_meta || {}) as any;
      const existing: ShipNotificationRecord[] = Array.isArray(typeMeta.shipping_notifications)
        ? typeMeta.shipping_notifications
        : [];

      if (!forceResend && alreadySent(existing, "stage_production_complete", null, null)) {
        return NextResponse.json({ success: true, skipped: "already_sent" });
      }

      const invoiceNum = typeMeta.qb_invoice_number || (job as any).job_number || "";
      const portalToken = (job as any).portal_token;
      const portalUrl = portalToken ? `${BASE_URL()}/portal/${portalToken}` : null;
      const projectTitle = (job as any).title || "your order";

      const html = renderBrandedEmail({
        heading: "Production complete",
        greeting: `Hi ${clientName || "there"},`,
        bodyHtml: `Production for <strong>${projectTitle}</strong> is complete. All items are at our facility and ready for fulfillment.`,
        cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
        closing: "Welcome to the party,\nHouse Party Distro",
      });

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject: `Production complete — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html,
      });

      const newRecord: ShipNotificationRecord = {
        type: "stage_production_complete",
        decoratorId: null,
        decoratorName: null,
        sentAt: new Date().toISOString(),
        recipients: [clientEmail],
        tracking: null,
        resend: !!forceResend,
      };
      await sb.from("jobs").update({ type_meta: { ...typeMeta, shipping_notifications: [...existing, newRecord] } }).eq("id", jobId);

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: `Auto-email: production complete notification sent to ${clientEmail}`,
      });

      return NextResponse.json({ success: true, record: newRecord });
    }

    // ── Revised invoice ────────────────────────────────────────────────────────
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

      const html = renderBrandedEmail({
        heading: `Revised invoice #${invoiceNum}`,
        greeting: `Hi ${clientName || "there"},`,
        bodyHtml: `Your invoice #${invoiceNum} has been updated with final shipped quantities. The revised copy is attached and waiting in your portal.`,
        cta: qbPaymentLink ? { label: "Pay Online", url: qbPaymentLink, style: "green" } : undefined,
        secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
      });

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject: `Revised invoice ${invoiceNum} — ${clientName} · ${projectTitle}`,
        html,
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
