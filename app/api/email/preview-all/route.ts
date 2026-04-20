export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renderBrandedEmail, trackingBlock, missingAttachmentBlock } from "@/lib/email-template";

// POST /api/email/preview-all
// Sends one preview of each active email template to { to } (defaults to
// the calling user's email). No DB writes — pure render + send. Every
// subject is prefixed with "[PREVIEW]" and every body ends with a
// demo-content footer so they're obviously not real notifications.
// Uses a real sample job for realistic data (PDFs, job numbers, client name).

const BASE_URL = () =>
  process.env.NEXT_PUBLIC_SITE_URL ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
const FROM_ADDR = () => process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
const FROM_PO = () => process.env.EMAIL_FROM_PO || FROM_ADDR();

const DEMO_FOOTER =
  `<div style="max-width:560px;margin:0 auto;padding:0 20px;">` +
  `<hr style="border:none;border-top:1px solid #e5e7eb;margin:12px 0;"/>` +
  `<p style="font-size:10px;color:#aaa;line-height:1.5;font-family:-apple-system,sans-serif;">` +
  `<em>[PREVIEW] This is a rendered sample of what OpsHub would send. ` +
  `No data was written, no client was notified, no state changed. ` +
  `For review only.</em></p></div>`;

type PdfResult = { buffer: Buffer | null; status: number; error: string | null; size: number };

async function fetchPdfSafe(url: string, retried = false): Promise<PdfResult> {
  try {
    const res = await fetch(url, { headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! } });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      // 429 from Browserless — wait and retry once
      if (res.status === 500 && errBody.includes("429") && !retried) {
        await new Promise(r => setTimeout(r, 2500));
        return fetchPdfSafe(url, true);
      }
      return { buffer: null, status: res.status, error: errBody.slice(0, 600) || `HTTP ${res.status}`, size: 0 };
    }
    const buf = Buffer.from(await res.arrayBuffer());
    return { buffer: buf, status: 200, error: null, size: buf.length };
  } catch (e: any) {
    return { buffer: null, status: 0, error: e?.message || "fetch threw", size: 0 };
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const to: string = body.to || user.email || "";
    if (!to) return NextResponse.json({ error: "No recipient" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Pick the richest sample job — prefers one with QB invoice, shipped items,
    // and attached proofs so ALL attachments render. Falls back progressively.
    // Allow caller override via { jobId } in the body.
    let sample: any = null;
    if (body.jobId) {
      const r = await admin
        .from("jobs")
        .select("id, title, job_number, type_meta, portal_token, shipping_route, clients(name)")
        .eq("id", body.jobId)
        .maybeSingle();
      sample = r.data;
    }

    if (!sample) {
      // Try: job with QB invoice + at least one shipped item
      const { data: candidates } = await admin
        .from("jobs")
        .select("id, title, job_number, type_meta, portal_token, shipping_route, clients(name), items(id, pipeline_stage, sell_per_unit)")
        .not("type_meta->qb_invoice_number", "is", null)
        .order("created_at", { ascending: false })
        .limit(10);

      const withShipped = (candidates || []).find((j: any) =>
        (j.items || []).some((it: any) => it.pipeline_stage === "shipped")
      );
      const withPriced = (candidates || []).find((j: any) =>
        (j.items || []).some((it: any) => parseFloat(it.sell_per_unit) > 0)
      );
      sample = withShipped || withPriced || (candidates?.[0] as any) || null;

      // Strip the items join for the rest of the code
      if (sample) delete sample.items;
    }

    if (!sample) {
      const r = await admin
        .from("jobs")
        .select("id, title, job_number, type_meta, portal_token, shipping_route, clients(name)")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      sample = r.data;
    }

    if (!sample) return NextResponse.json({ error: "No jobs in database to use as sample" }, { status: 400 });

    const jobId = sample.id;
    const jobNum = sample.job_number || "HPD-XXXX-XXX";
    const invoiceNum = (sample.type_meta as any)?.qb_invoice_number || jobNum;
    const qbPaymentLink = (sample.type_meta as any)?.qb_payment_link || "";
    const clientName = (sample.clients as any)?.name || "Sample Client";
    const projectTitle = sample.title || "Sample Project";
    const portalUrl = sample.portal_token ? `${BASE_URL()}/portal/${sample.portal_token}` : null;
    const designerPortalExample = `${BASE_URL()}/design/preview`;
    const artIntakePortalExample = `${BASE_URL()}/portal/client/preview`;

    // Pre-fetch PDFs serially — Browserless rate-limits concurrent sessions
    // on lower-tier plans (HTTP 429 when we burst 4 in parallel).
    // Production sends fire one PDF at a time so this only affects preview.
    const quotePdf = await fetchPdfSafe(`${BASE_URL()}/api/pdf/quote/${jobId}`);
    await new Promise(r => setTimeout(r, 400));
    const invoicePdf = await fetchPdfSafe(`${BASE_URL()}/api/pdf/invoice/${jobId}?download=1`);
    await new Promise(r => setTimeout(r, 400));
    const poPdf = await fetchPdfSafe(`${BASE_URL()}/api/pdf/po/${jobId}?download=1`);
    await new Promise(r => setTimeout(r, 400));
    const packingSlipPdf = await fetchPdfSafe(`${BASE_URL()}/api/pdf/packing-slip/${jobId}`);

    const pdfDiagnostics = {
      quote: { ok: !!quotePdf.buffer, size: quotePdf.size, status: quotePdf.status, error: quotePdf.error },
      invoice: { ok: !!invoicePdf.buffer, size: invoicePdf.size, status: invoicePdf.status, error: invoicePdf.error },
      po: { ok: !!poPdf.buffer, size: poPdf.size, status: poPdf.status, error: poPdf.error },
      packing_slip: { ok: !!packingSlipPdf.buffer, size: packingSlipPdf.size, status: packingSlipPdf.status, error: packingSlipPdf.error },
    };

    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    // Sample tracking for shipping email previews
    const sampleTracking = "1Z999AA10123456784";
    const sampleCarrier = "UPS";

    type PreviewEmail = {
      key: string;
      subject: string;
      html: string;
      from: string;
      attachments?: { filename: string; content: string }[];
    };

    const emails: PreviewEmail[] = [
      // 1. Quote
      {
        key: "quote",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Quote ${jobNum} — House Party Distro`,
        html:
          renderBrandedEmail({
            heading: `Quote ${jobNum}`,
            greeting: `Hi ${clientName},`,
            bodyHtml: `Your quote ${jobNum} is attached for review. When you're ready to move forward, you can approve it directly in your portal, or request changes if anything needs a second pass.`,
            extraHtml: quotePdf.buffer ? "" : missingAttachmentBlock(`HPD-Quote-${jobNum}.pdf`, quotePdf.error),
            cta: portalUrl ? { label: "Approve Quote", url: portalUrl, style: "dark" } : undefined,
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
          }) + DEMO_FOOTER,
        attachments: quotePdf.buffer ? [{ filename: `HPD-Quote-${jobNum}.pdf`, content: quotePdf.buffer.toString("base64") }] : [],
      },
      // 2. Invoice
      {
        key: "invoice",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Invoice ${invoiceNum} — House Party Distro`,
        html:
          renderBrandedEmail({
            heading: `Invoice #${invoiceNum}`,
            greeting: `Hi ${clientName},`,
            bodyHtml: `Your invoice #${invoiceNum} is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.`,
            extraHtml: invoicePdf.buffer ? "" : missingAttachmentBlock(`HPD-Invoice-${invoiceNum}.pdf`, invoicePdf.error),
            cta: { label: "Pay Online", url: qbPaymentLink || "https://example.com/pay", style: "green" },
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
          }) + DEMO_FOOTER,
        attachments: invoicePdf.buffer ? [{ filename: `HPD-Invoice-${invoiceNum}.pdf`, content: invoicePdf.buffer.toString("base64") }] : [],
      },
      // 3. Proof ready
      {
        key: "proof_ready",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Proof ready for review — ${clientName} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: "Proof ready for review",
            greeting: `Hi ${clientName},`,
            bodyHtml: `A proof is ready for your review in the portal. Approve when you're good with it, or request changes and we'll send it back for revisions.`,
            cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
          }) + DEMO_FOOTER,
      },
      // 4. Drop-ship shipment
      {
        key: "order_shipped_vendor",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Part of your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: "Part of your order has shipped",
            greeting: `Hi ${clientName},`,
            bodyHtml: `Part of your order for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong> has shipped. The packing slip is attached.`,
            extraHtml: trackingBlock(sampleTracking, sampleCarrier) + (packingSlipPdf.buffer ? "" : missingAttachmentBlock(`HPD-PackingSlip-${invoiceNum}-SampleVendor.pdf`, packingSlipPdf.error)),
            cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
            closing: "Welcome to the party!\nHouse Party Distro",
          }) + DEMO_FOOTER,
        attachments: packingSlipPdf.buffer ? [{ filename: `HPD-PackingSlip-${invoiceNum}-SampleVendor.pdf`, content: packingSlipPdf.buffer.toString("base64") }] : [],
      },
      // 5. Ship-through shipment
      {
        key: "order_shipped_hpd",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: "Your order has shipped",
            greeting: `Hi ${clientName},`,
            bodyHtml: `Your order for <strong>${projectTitle}</strong> has shipped. The packing slip is attached.`,
            extraHtml: trackingBlock(sampleTracking, sampleCarrier) + (packingSlipPdf.buffer ? "" : missingAttachmentBlock(`HPD-PackingSlip-${invoiceNum}.pdf`, packingSlipPdf.error)),
            cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
            closing: "Welcome to the party!\nHouse Party Distro",
          }) + DEMO_FOOTER,
        attachments: packingSlipPdf.buffer ? [{ filename: `HPD-PackingSlip-${invoiceNum}.pdf`, content: packingSlipPdf.buffer.toString("base64") }] : [],
      },
      // 6. Production complete (stage route — NEW)
      {
        key: "production_complete",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Production complete — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: "Production complete",
            greeting: `Hi ${clientName},`,
            bodyHtml: `Production for <strong>${projectTitle}</strong> is complete. All items are at our facility and ready for fulfillment.`,
            cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
          }) + DEMO_FOOTER,
      },
      // 7. Revised invoice
      {
        key: "invoice_revised",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Revised invoice ${invoiceNum} — ${clientName} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: `Revised invoice #${invoiceNum}`,
            greeting: `Hi ${clientName},`,
            bodyHtml: `Your invoice #${invoiceNum} has been updated with final shipped quantities. The revised copy is attached and waiting in your portal.`,
            extraHtml: invoicePdf.buffer ? "" : missingAttachmentBlock(`HPD-Invoice-${invoiceNum}-Revised.pdf`, invoicePdf.error),
            cta: { label: "Pay Online", url: qbPaymentLink || "https://example.com/pay", style: "green" },
            secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
          }) + DEMO_FOOTER,
        attachments: invoicePdf.buffer ? [{ filename: `HPD-Invoice-${invoiceNum}-Revised.pdf`, content: invoicePdf.buffer.toString("base64") }] : [],
      },
      // 8. Payment received
      {
        key: "payment_received",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Payment received — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          renderBrandedEmail({
            heading: "Payment received",
            greeting: `Hi ${clientName},`,
            bodyHtml: `Payment of <strong>$2,450.00</strong> received for <strong>Invoice ${invoiceNum} · ${projectTitle}</strong>. Appreciate you.`,
            cta: portalUrl ? { label: "View in Portal", url: portalUrl, style: "outline" } : undefined,
          }) + DEMO_FOOTER,
      },
      // 9. Purchase order (decorator-facing)
      {
        key: "po",
        from: FROM_PO(),
        subject: `[PREVIEW] HPD PO# ${invoiceNum} — House Party Distro`,
        html:
          renderBrandedEmail({
            heading: `Purchase order ${invoiceNum}`,
            greeting: "Hi,",
            bodyHtml: `Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.`,
            extraHtml: poPdf.buffer ? "" : missingAttachmentBlock(`HPD-PO-${invoiceNum}.pdf`, poPdf.error),
            cta: { label: "View in Vendor Portal", url: `${BASE_URL()}/portal/vendor/preview`, style: "dark" },
            hint: "You can confirm receipt, update production status, and enter tracking directly from the portal.",
            closing: "Thanks,\nHouse Party Distro",
          }) + DEMO_FOOTER,
        attachments: poPdf.buffer ? [{ filename: `HPD-PO-${invoiceNum}.pdf`, content: poPdf.buffer.toString("base64") }] : [],
      },
      // 10. Art intake (client-facing)
      {
        key: "art_intake",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Sample brief — quick brief from House Party Distro`,
        html:
          renderBrandedEmail({
            heading: "Quick art brief — 2 minutes",
            greeting: `Hi ${clientName},`,
            bodyHtml: `To kick off <strong>Sample Brief</strong>, we need a few things from you — what it's for, some reference images, and a vibe. Your link below is a permanent home for every art request we have in flight together, so you can come back any time.`,
            cta: { label: "Open your art requests →", url: artIntakePortalExample, style: "dark" },
            hint: "Bookmark this link. Every art request we have in motion for you lives here.",
            closing: "",
          }) + DEMO_FOOTER,
      },
      // 11. New art brief (designer-facing)
      {
        key: "new_art_brief",
        from: FROM_ADDR(),
        subject: `[PREVIEW] New art brief: Sample Brief`,
        html:
          renderBrandedEmail({
            heading: `New brief for ${clientName}`,
            bodyHtml: `<strong>Sample Brief</strong> is ready for you to work on.`,
            cta: { label: "Open your dashboard →", url: designerPortalExample, style: "dark" },
            hint: "This link is permanent — bookmark it and come back anytime.",
            closing: "",
          }) + DEMO_FOOTER,
      },
      // 12. Daily digest (owner internal)
      {
        key: "daily_digest",
        from: FROM_ADDR(),
        subject: `[PREVIEW] OpsHub · 🟡 3 alerts — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        html:
          `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px 20px;color:#111">` +
          `<div style="font-size:11px;color:#888;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">OpsHub</div>` +
          `<h1 style="font-size:24px;margin:0 0 6px;font-weight:700;letter-spacing:-0.01em;">Daily digest</h1>` +
          `<p style="color:#666;margin:0 0 20px;font-size:13px">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · 3 alerts</p>` +
          `<h3 style="color:#d97706;margin:16px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.06em">Action needed (3)</h3>` +
          `<ul style="margin:0;padding-left:20px;color:#444">` +
          `<li style="margin:4px 0;font-size:14px">Quote HPD-2604-012 awaiting client approval for 5 days</li>` +
          `<li style="margin:4px 0;font-size:14px">Invoice #1234 overdue by 2 days — ${clientName}</li>` +
          `<li style="margin:4px 0;font-size:14px">${projectTitle} has items stalled in production for 7+ days</li>` +
          `</ul>` +
          `<p style="margin:24px 0 0;font-size:12px;color:#999">— OpsHub</p>` +
          `</div>` + DEMO_FOOTER,
      },
    ];

    const results: { key: string; ok: boolean; error?: string }[] = [];
    for (const email of emails) {
      try {
        const { error } = await resend.emails.send({
          from: email.from,
          to,
          subject: email.subject,
          html: email.html,
          ...(email.attachments && email.attachments.length > 0 ? { attachments: email.attachments } : {}),
        });
        results.push({ key: email.key, ok: !error, error: error?.message });
      } catch (e: any) {
        results.push({ key: email.key, ok: false, error: e.message });
      }
      // Small spacing between sends so Resend doesn't rate-limit in one burst
      await new Promise(r => setTimeout(r, 200));
    }

    return NextResponse.json({
      success: true,
      to,
      sampleJob: { id: jobId, jobNumber: jobNum, invoiceNumber: invoiceNum, clientName, projectTitle },
      sent: results,
      totalSent: results.filter(r => r.ok).length,
      totalFailed: results.filter(r => !r.ok).length,
      pdfDiagnostics,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
