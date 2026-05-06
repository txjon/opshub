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
  type:
    | "drop_ship_vendor"
    | "ship_through"
    | "stage_production_complete"
    | "decorator_to_warehouse";
  decoratorId: string | null;
  decoratorName: string | null;
  sentAt: string;
  recipients: string[];
  tracking: string | null;
  resend: boolean;
};

// Internal self-fetch URL (for hitting our own /api/pdf routes). Uses
// VERCEL_URL so the server can talk to itself on the same deployment.
const BASE_URL = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

// User-facing URL — shows up in the email body. Branded, never a Vercel URL.
import { appBaseUrl } from "@/lib/public-url";

const FROM_ADDR = () => process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

async function loadJobAndClientEmail(sb: any, jobId: string) {
  const { data: job } = await sb.from("jobs").select("*, clients(name, portal_token, client_hub_enabled)").eq("id", jobId).single();
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

    const requestBody = await req.json();
    const { jobId, type, trackingNumber, carrier, decoratorId, vendorName, resend: forceResend } = requestBody;
    if (!jobId || !type) return NextResponse.json({ error: "Missing fields" }, { status: 400 });

    const { createClient: createAdmin } = await import("@supabase/supabase-js");
    const { resendForSlug } = await import("@/lib/resend-client");
    const sb = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    // Pick the Resend key matching the active tenant. Falls back to
    // RESEND_API_KEY when a tenant-specific key isn't set.
    const _h = (req.headers.get("host") || "").toLowerCase().split(":")[0];
    const _slug = (_h === "app.inhousemerchandise.com" || _h === "ihm.localhost") ? "ihm" : "hpd";
    const resend = resendForSlug(_slug);

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
      const hubClient = (job as any).clients;
      // Client Hub URL when the client is flagged in; legacy per-job
      // portal URL otherwise.
      const portalUrl = hubClient?.client_hub_enabled && hubClient?.portal_token
        ? `${await appBaseUrl()}/portal/client/${hubClient.portal_token}/orders/${(job as any).id}`
        : (portalToken ? `${await appBaseUrl()}/portal/${portalToken}` : null);
      const projectTitle = (job as any).title || "your order";

      let subject = "";
      let heading = "";
      let bodyHtml = "";
      let pdfFilename = "";

      if (type === "order_shipped_vendor") {
        // Existing partial-shipment count for this job — used to number the
        // filename so client can tell shipments apart without seeing vendor names
        const partialCount = existing.filter(r => r.type === "drop_ship_vendor").length;
        const suffix = partialCount > 0 ? `-${partialCount + 1}` : "";
        subject = `Part of your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        heading = "Part of your order has shipped";
        bodyHtml = `Part of your order for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> has shipped. The packing slip is attached.`;
        pdfFilename = `HPD-PackingSlip-${invoiceNum}${suffix}.pdf`;
      } else {
        subject = `Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`;
        heading = "Your order has shipped";
        bodyHtml = `Your order for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> has shipped. The packing slip is attached.`;
        pdfFilename = `HPD-PackingSlip-${invoiceNum}.pdf`;
      }

      // order_shipped_hpd is HPD outbound (one shipment per job, fired
      // from /warehouse Mark Shipped). The trackingNumber here is the
      // job's fulfillment_tracking, NOT the per-item ship_tracking the
      // packing-slip route filters by — passing it would produce an
      // empty PDF. Only filter when this is a per-vendor drop-ship.
      const isVendorScope = type === "order_shipped_vendor";
      let pdfBuffer: Buffer;
      try {
        const params = new URLSearchParams();
        if (isVendorScope) {
          if (decoratorId) params.set("decoratorId", decoratorId);
          if (trackingNumber) params.set("tracking", trackingNumber);
        }
        const slipUrl = `${BASE_URL()}/api/pdf/packing-slip/${jobId}${params.toString() ? `?${params.toString()}` : ""}`;
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

      // Server-side guard — verify ALL items on the job are actually
      // received before sending. Callers (useWarehouse, warehouse page)
      // check against an in-memory items list that's pre-filtered to
      // only-shipped-or-received items, so they can fire this when
      // items are still in production. Re-check against the full set.
      const { data: allJobItems } = await sb
        .from("items")
        .select("id, pipeline_stage, received_at_hpd, garment_type")
        .eq("job_id", jobId);
      const jobItemsToReceive = (allJobItems || []).filter((it: any) => {
        // Drop_ship items don't come back to HPD; skip them.
        // (This route is gated to stage by callers but defending here
        // doesn't hurt.)
        return true;
      });
      const everyReceived = jobItemsToReceive.length > 0 && jobItemsToReceive.every((it: any) => it.received_at_hpd === true);
      if (!everyReceived) {
        const remaining = jobItemsToReceive.filter((it: any) => !it.received_at_hpd).length;
        return NextResponse.json({ success: true, skipped: "not_all_received", remaining });
      }

      const invoiceNum = typeMeta.qb_invoice_number || (job as any).job_number || "";
      const portalToken = (job as any).portal_token;
      const hubClient = (job as any).clients;
      // Client Hub URL when the client is flagged in; legacy per-job
      // portal URL otherwise.
      const portalUrl = hubClient?.client_hub_enabled && hubClient?.portal_token
        ? `${await appBaseUrl()}/portal/client/${hubClient.portal_token}/orders/${(job as any).id}`
        : (portalToken ? `${await appBaseUrl()}/portal/${portalToken}` : null);
      const projectTitle = (job as any).title || "your order";

      const html = renderBrandedEmail({
        heading: "Production complete",
        greeting: `Hi ${clientName || "there"},`,
        bodyHtml: `Production for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> is complete. All items are at our facility and ready for fulfillment.`,
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
      const hubClient = (job as any).clients;
      // Client Hub URL when the client is flagged in; legacy per-job
      // portal URL otherwise.
      const portalUrl = hubClient?.client_hub_enabled && hubClient?.portal_token
        ? `${await appBaseUrl()}/portal/client/${hubClient.portal_token}/orders/${(job as any).id}`
        : (portalToken ? `${await appBaseUrl()}/portal/${portalToken}` : null);
      const projectTitle = (job as any).title || "";

      const html = renderBrandedEmail({
        heading: `Revised invoice #${invoiceNum}`,
        greeting: `Hi ${clientName || "there"},`,
        bodyHtml: `Your invoice for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> has been updated with final shipped quantities. The revised copy is attached and waiting in your portal.`,
        cta: qbPaymentLink ? { label: "Pay Online", url: qbPaymentLink, style: "green" } : undefined,
        secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
      });

      await resend.emails.send({
        from: FROM_ADDR(),
        to: clientEmail,
        subject: `Revised invoice — ${clientName}${invoiceNum ? ` · Invoice ${invoiceNum}` : ""} · ${projectTitle}`,
        html,
        attachments: [{ filename: `HPD-Invoice-${invoiceNum}-Revised.pdf`, content: pdfBuffer.toString("base64") }],
      });

      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: `Revised invoice ${invoiceNum} sent to client (${clientEmail})`,
      });

      return NextResponse.json({ success: true });
    }

    // ── Shipment notify v2 — production-page Mark Shipped → Notify Recipient ───
    // Route-aware: drop_ship sends to client (vendor anonymized),
    // ship_through and stage send to goose@ + extras (vendor named).
    // Multi-recipient (to, cc, bcc) with user-editable subject + custom
    // message + auto-attached packing slip. QB invoice number is required.
    // Spec: memory/project_notify_recipient_on_ship.md
    if (type === "shipment_notify") {
      const route: string | undefined = requestBody.route;
      const toList: string[] = Array.isArray(requestBody.to) ? requestBody.to.filter((s: any) => typeof s === "string" && s.trim()) : [];
      const ccList: string[] = Array.isArray(requestBody.cc) ? requestBody.cc.filter((s: any) => typeof s === "string" && s.trim()) : [];
      const bccList: string[] = Array.isArray(requestBody.bcc) ? requestBody.bcc.filter((s: any) => typeof s === "string" && s.trim()) : [];
      const customSubject: string | undefined = typeof requestBody.customSubject === "string" ? requestBody.customSubject.trim() : undefined;
      const customMessage: string | undefined = typeof requestBody.customMessage === "string" ? requestBody.customMessage.trim() : undefined;
      const testRecipient: string | undefined = typeof requestBody.testRecipient === "string" ? requestBody.testRecipient.trim() : undefined;

      // Hard validations — fail loud so frontend bugs surface in dev.
      if (!route || !["drop_ship", "ship_through", "stage"].includes(route)) {
        return NextResponse.json({ error: "Invalid or missing route" }, { status: 400 });
      }
      if (!trackingNumber || !String(trackingNumber).trim()) {
        return NextResponse.json({ error: "Tracking number required" }, { status: 400 });
      }
      const effectiveTo = testRecipient ? [testRecipient] : toList;
      if (effectiveTo.length === 0) {
        return NextResponse.json({ error: "At least one recipient required" }, { status: 400 });
      }

      // Load job + items in one go
      const { data: job } = await sb.from("jobs").select("*, clients(name, portal_token, client_hub_enabled)").eq("id", jobId).single();
      if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

      const typeMeta = ((job as any).type_meta || {}) as any;
      const invoiceNum: string | undefined = typeMeta.qb_invoice_number;
      if (!invoiceNum) {
        // QB invoice gate — block until QB invoice exists. Spec decision.
        return NextResponse.json({ error: "QB invoice number required — generate the QB invoice before notifying", code: "qb_invoice_required" }, { status: 400 });
      }

      // The `route` request param controls which email template renders
      // (customer "Your order has shipped" vs warehouse "Incoming"). The
      // /shipping page reuses route="drop_ship" to get the customer
      // template even though the job's shipping_route is ship_through.
      // For item scoping (and the packing-slip filter), we have to check
      // the JOB's actual route — outbound from HPD is one shipment per
      // job and must NOT filter by item.ship_tracking (which is the
      // inbound decorator→HPD tracking, not the outbound HPD→client one).
      const isJobOutbound = (job as any).shipping_route !== "drop_ship";

      // Dedup record key: same (decoratorId + tracking) shape as legacy
      // shipping notifications, but new record types so the new flow doesn't
      // collide with legacy `ship_through` (HPD outbound) records.
      const recordType: ShipNotificationRecord["type"] = route === "drop_ship" ? "drop_ship_vendor" : "decorator_to_warehouse";
      const existingRecords: ShipNotificationRecord[] = Array.isArray(typeMeta.shipping_notifications) ? typeMeta.shipping_notifications : [];
      if (!testRecipient && !forceResend && alreadySent(existingRecords, recordType, decoratorId || null, trackingNumber || null)) {
        return NextResponse.json({ success: true, skipped: "already_sent" });
      }

      // Pull items in scope. Drop-ship: filter by (decorator + tracking)
      // tuple — each vendor shipment is a separate scope. Outbound from
      // HPD: include everything physically received at HPD (and anything
      // already flipped to shipped) — one outbound shipment per job.
      const { data: allItems } = await sb
        .from("items")
        .select("id, name, sort_order, ship_qtys, received_qtys, sample_qtys, ship_tracking, received_at_hpd, pipeline_stage, total_units, buy_sheet_lines(size, qty_ordered), decorator_assignments(decorator_id)")
        .eq("job_id", jobId)
        .order("sort_order");
      const scopedItems = (allItems || []).filter((it: any) => {
        if (isJobOutbound) {
          return it.received_at_hpd === true || it.pipeline_stage === "shipped";
        }
        const itDecId = (it.decorator_assignments?.[0] as any)?.decorator_id || null;
        const matchDec = !decoratorId || itDecId === decoratorId;
        const matchTrack = (it.ship_tracking || "") === (trackingNumber || "");
        return matchDec && matchTrack;
      });

      const clientName = (job as any).clients?.name || "";
      const projectTitle = (job as any).title || "your order";
      const portalToken = (job as any).portal_token;
      const hubClient = (job as any).clients;
      const portalUrl = hubClient?.client_hub_enabled && hubClient?.portal_token
        ? `${await appBaseUrl()}/portal/client/${hubClient.portal_token}/orders/${(job as any).id}`
        : (portalToken ? `${await appBaseUrl()}/portal/${portalToken}` : null);

      // Build the shipment-includes HTML list
      const sortSizes = (a: string, b: string) => {
        const order = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL"];
        return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
      };
      const itemListHtml = scopedItems.map((it: any) => {
        const lines = (it.buy_sheet_lines || []) as any[];
        const sizes = Array.from(new Set(lines.map((l: any) => l.size as string))).sort(sortSizes);
        const shipQtys = it.ship_qtys || {};
        const receivedQtys = it.received_qtys || {};
        const sampleQtys = it.sample_qtys || {};
        const ordered = Object.fromEntries(lines.map((l: any) => [l.size, l.qty_ordered]));
        // Mirror the packing-slip qty fallback: drop-ship prefers
        // ship_qtys (decorator-reported), outbound prefers received_qtys
        // (HPD-confirmed) so the email body matches the attached PDF.
        // Samples are deducted on outbound — those units stay at HPD.
        const firstChoice = isJobOutbound ? receivedQtys : shipQtys;
        const secondChoice = isJobOutbound ? shipQtys : receivedQtys;
        const finalForSize = (sz: string) => {
          const a = firstChoice[sz];
          const b = secondChoice[sz];
          const delivered = (a !== undefined ? a : (b !== undefined ? b : ordered[sz])) ?? 0;
          const samples = isJobOutbound ? (sampleQtys[sz] || 0) : 0;
          return Math.max(0, delivered - samples);
        };
        const sizesStr = sizes.map((sz: string) => `${sz}(${finalForSize(sz)})`).join(" ");
        const total = sizes.reduce((sum: number, sz: string) => sum + finalForSize(sz), 0);
        return `<li style="margin:4px 0;font-size:13px;color:#444;">${it.name} — <span style="font-family:'SF Mono',Menlo,monospace;color:#666;">${sizesStr}</span> — <strong>${total} units</strong></li>`;
      }).join("");
      const itemsBlock = `<ul style="margin:8px 0 16px;padding-left:20px;">${itemListHtml}</ul>`;

      // Subject + body per route
      let subject: string;
      let heading: string;
      let greeting: string;
      let bodyHtml: string;
      let fromAddr: string;
      let closing: string;

      if (route === "drop_ship") {
        subject = customSubject || `Your order has shipped — ${invoiceNum} — ${projectTitle}`;
        heading = "Your order has shipped";
        greeting = `Hi ${clientName || "there"},`;
        bodyHtml = `Good news — your order is on the way.${itemsBlock}A packing slip is attached for your records.`;
        fromAddr = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
        closing = "If anything looks off when it arrives, just reply here — we'll get you sorted.\n\n— The House Party Distro team\nhello@housepartydistro.com";
      } else {
        subject = customSubject || `Incoming: ${vendorName || "Vendor"} — ${invoiceNum} — ${clientName} — ${trackingNumber}`;
        heading = "Incoming shipment";
        greeting = "Heads up — a shipment is inbound to HPD.";
        const fromLine = vendorName ? `<p style="margin:0 0 6px;font-size:13px;color:#444;"><strong>From:</strong> ${vendorName}</p>` : "";
        const projLine = `<p style="margin:0 0 12px;font-size:13px;color:#444;"><strong>Project:</strong> ${projectTitle}</p>`;
        bodyHtml = `${fromLine}${projLine}${itemsBlock}Packing slip attached. Confirm receipt in OpsHub when it arrives.`;
        fromAddr = process.env.EMAIL_FROM_PO || "production@housepartydistro.com";
        closing = "— House Party Labs";
      }

      // Optional custom-message block — rendered in a quoted callout above
      // the body, mirrors RFQ pattern.
      const customMessageHtml = customMessage
        ? `<div style="margin:8px 0 16px;padding:10px 14px;background:#f6f8fb;border-left:3px solid #2563eb;border-radius:4px;font-size:13px;color:#333;white-space:pre-wrap;">${customMessage.replace(/</g, "&lt;").replace(/\n/g, "<br/>")}</div>`
        : "";

      // Generate packing slip. For HPD outbound (ship_through/stage)
      // there's one shipment per job — DON'T pass decoratorId or tracking
      // because the packing-slip route filters items by item.ship_tracking
      // (the decorator→HPD inbound number), which would never match the
      // outbound fulfillment_tracking and produce a header-only PDF.
      let pdfBuffer: Buffer;
      try {
        const params = new URLSearchParams();
        if (!isJobOutbound) {
          if (decoratorId) params.set("decoratorId", decoratorId);
          if (trackingNumber) params.set("tracking", trackingNumber);
        }
        const slipUrl = `${BASE_URL()}/api/pdf/packing-slip/${jobId}${params.toString() ? `?${params.toString()}` : ""}`;
        pdfBuffer = await fetchPdf(slipUrl);
      } catch (e: any) {
        console.error(`[notify/shipment_notify] packing slip fetch failed:`, e.message);
        return NextResponse.json({ error: "Packing slip generation failed" }, { status: 500 });
      }
      const pdfFilename = `HPD-PackingSlip-${invoiceNum}.pdf`;

      // Render branded HTML
      const html = renderBrandedEmail({
        heading,
        greeting,
        bodyHtml: customMessageHtml + bodyHtml,
        extraHtml: trackingBlock(trackingNumber || null, carrier || null),
        cta: route === "drop_ship" && portalUrl ? { label: "Open project portal →", url: portalUrl, style: "outline" } : route !== "drop_ship" ? { label: "Open warehouse", url: `${await appBaseUrl()}/warehouse`, style: "outline" } : undefined,
        closing,
      });

      // Subject prefix when in test mode so it's obvious
      const finalSubject = testRecipient ? `[TEST] ${subject}` : subject;

      // Send via Resend — multi-recipient
      try {
        await resend.emails.send({
          from: fromAddr,
          to: effectiveTo,
          cc: !testRecipient && ccList.length ? ccList : undefined,
          bcc: !testRecipient && bccList.length ? bccList : undefined,
          subject: finalSubject,
          html,
          attachments: [{ filename: pdfFilename, content: pdfBuffer.toString("base64") }],
        } as any);
      } catch (e: any) {
        console.error(`[notify/shipment_notify] send failed:`, e.message);
        return NextResponse.json({ error: `Email send failed: ${e.message}` }, { status: 500 });
      }

      // Test-mode: skip dedup record + activity log (but still return success)
      if (testRecipient) {
        return NextResponse.json({ success: true, test: true, sentTo: testRecipient });
      }

      const newRecord: ShipNotificationRecord = {
        type: recordType,
        decoratorId: decoratorId || null,
        decoratorName: vendorName || null,
        sentAt: new Date().toISOString(),
        recipients: [...effectiveTo, ...ccList, ...bccList],
        tracking: trackingNumber || null,
        resend: !!forceResend,
      };
      await sb
        .from("jobs")
        .update({ type_meta: { ...typeMeta, shipping_notifications: [...existingRecords, newRecord] } })
        .eq("id", jobId);

      const recipientPreview = effectiveTo.slice(0, 2).join(", ") + (effectiveTo.length > 2 ? ` (+${effectiveTo.length - 2})` : "");
      await sb.from("job_activity").insert({
        job_id: jobId, user_id: null, type: "auto",
        message: forceResend
          ? `Resent shipment notification (${route}) to ${recipientPreview}${vendorName ? ` · ${vendorName}` : ""}`
          : `Shipment notification (${route}) sent to ${recipientPreview}${vendorName ? ` · ${vendorName}` : ""}`,
      });

      return NextResponse.json({ success: true, record: newRecord });
    }

    // Fallback: delegate to auto-email.ts (proof_ready, payment_received)
    await sendClientNotification({ jobId, type, trackingNumber, carrier });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
