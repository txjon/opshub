export const runtime = "nodejs";
export const maxDuration = 120;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
  `<hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0 12px"/>` +
  `<p style="font-size:10px;color:#aaa;line-height:1.5">` +
  `<em>[PREVIEW] This is a rendered sample of what OpsHub would send. ` +
  `No data was written, no client was notified, no state changed. ` +
  `For review only.</em></p>`;

function portalBtn(url: string | null, label = "View in Portal") {
  if (!url) return "";
  return `<a href="${url}" style="display:inline-block;padding:10px 24px;background:#f3f3f5;color:#1a1a1a;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px;border:1px solid #dcdce0">${label}</a>`;
}
function approveBtn(url: string | null) {
  if (!url) return "";
  return `<a href="${url}" style="display:inline-block;padding:12px 28px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">Approve Quote</a>`;
}
function payBtn(url: string | null) {
  if (!url) return "";
  return `<a href="${url}" style="display:inline-block;padding:12px 28px;background:#34c97a;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:14px">Pay Online</a>`;
}

async function fetchPdfSafe(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY! } });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
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

    // Pick a sample job — prefer one with a QB invoice, fall back to newest
    let { data: sample } = await admin
      .from("jobs")
      .select("id, title, job_number, type_meta, portal_token, shipping_route, clients(name)")
      .not("type_meta->qb_invoice_number", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

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

    // Pre-fetch PDFs we'll attach (ok if they fail — body still renders)
    const [quotePdf, invoicePdf, invProofsPdf, poPdf, packingSlipPdf] = await Promise.all([
      fetchPdfSafe(`${BASE_URL()}/api/pdf/quote/${jobId}`),
      fetchPdfSafe(`${BASE_URL()}/api/pdf/invoice/${jobId}?download=1`),
      fetchPdfSafe(`${BASE_URL()}/api/pdf/invoice-proofs/${jobId}?download=1`),
      fetchPdfSafe(`${BASE_URL()}/api/pdf/po/${jobId}?download=1`),
      fetchPdfSafe(`${BASE_URL()}/api/pdf/packing-slip/${jobId}`),
    ]);

    const { Resend } = await import("resend");
    const resend = new Resend(process.env.RESEND_API_KEY);

    const trackingLine = `<p>Tracking: <strong>1Z999AA10123456784</strong> · UPS</p>`;

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
          `<p>Hi ${clientName},</p>` +
          `<p>Your quote ${jobNum} is attached for review. When you're ready to move forward, you can approve it directly in your portal, or request changes if anything needs a second pass.</p>` +
          `<p style="margin:20px 0;display:flex;gap:10px">${approveBtn(portalUrl)} ${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: quotePdf ? [{ filename: `HPD-Quote-${jobNum}.pdf`, content: quotePdf.toString("base64") }] : [],
      },
      // 2. Invoice
      {
        key: "invoice",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Invoice ${invoiceNum} — House Party Distro`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Your invoice #${invoiceNum} is attached. You can complete payment through your portal, where you'll also find your approved proofs and full project details.</p>` +
          `<p style="margin:20px 0;display:flex;gap:10px">${payBtn(qbPaymentLink || "https://example.com/pay")} ${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: invoicePdf ? [{ filename: `HPD-Invoice-${invoiceNum}.pdf`, content: invoicePdf.toString("base64") }] : [],
      },
      // 3. Invoice + Proofs
      {
        key: "invoice_proofs",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Invoice ${invoiceNum} & Proofs — House Party Distro`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Your invoice #${invoiceNum} and proofs are ready and waiting in your portal. Approve your proofs and complete payment or request any changes there. We'll get production rolling as soon as proofs are approved and payment is received.</p>` +
          `<p style="margin:20px 0;display:flex;gap:10px">${payBtn(qbPaymentLink || "https://example.com/pay")} ${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: invProofsPdf ? [{ filename: `HPD-Invoice-Proofs-${invoiceNum}.pdf`, content: invProofsPdf.toString("base64") }] : [],
      },
      // 4. Proof ready
      {
        key: "proof_ready",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Proof ready for review — ${clientName} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>A proof is ready for your review in the portal. Approve when you're good with it, or request changes and we'll send it back for revisions.</p>` +
          `<p style="margin:20px 0">${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
      },
      // 5. Drop-ship shipment
      {
        key: "order_shipped_vendor",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Part of your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Part of your order for Invoice ${invoiceNum} · ${projectTitle} has shipped, packing slip attached.</p>` +
          trackingLine +
          `<p style="margin:16px 0">${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party!<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: packingSlipPdf ? [{ filename: `HPD-PackingSlip-${invoiceNum}-SampleVendor.pdf`, content: packingSlipPdf.toString("base64") }] : [],
      },
      // 6. Ship-through shipment
      {
        key: "order_shipped_hpd",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Your order for ${projectTitle} has shipped from House Party Distro. The packing slip is attached.</p>` +
          trackingLine +
          `<p style="margin:16px 0">${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party!<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: packingSlipPdf ? [{ filename: `HPD-PackingSlip-${invoiceNum}.pdf`, content: packingSlipPdf.toString("base64") }] : [],
      },
      // 7. Stage shipment (same copy as 6, fired from Fulfillment)
      {
        key: "order_shipped_stage",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Your order has shipped — ${clientName} · Invoice ${invoiceNum} · ${projectTitle} (stage route)`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Your order for ${projectTitle} has shipped from House Party Distro. The packing slip is attached.</p>` +
          trackingLine +
          `<p style="margin:16px 0">${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party!<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: packingSlipPdf ? [{ filename: `HPD-PackingSlip-${invoiceNum}.pdf`, content: packingSlipPdf.toString("base64") }] : [],
      },
      // 8. Revised invoice
      {
        key: "invoice_revised",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Revised invoice ${invoiceNum} — ${clientName} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Your invoice ${invoiceNum} has been updated with final shipped quantities. The revised copy is attached and waiting in your portal.</p>` +
          `<p style="margin:20px 0;display:flex;gap:10px">${payBtn(qbPaymentLink || "https://example.com/pay")} ${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: invoicePdf ? [{ filename: `HPD-Invoice-${invoiceNum}-Revised.pdf`, content: invoicePdf.toString("base64") }] : [],
      },
      // 9. Payment received
      {
        key: "payment_received",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Payment received — ${clientName} · ${projectTitle}`,
        html:
          `<p>Hi ${clientName},</p>` +
          `<p>Payment of <strong>$2,450.00</strong> received for ${projectTitle}. Appreciate you.</p>` +
          `<p style="margin:20px 0">${portalBtn(portalUrl)}</p>` +
          `<p>Welcome to the party,<br/>House Party Distro</p>` + DEMO_FOOTER,
      },
      // 10. Purchase order (decorator-facing)
      {
        key: "po",
        from: FROM_PO(),
        subject: `[PREVIEW] HPD PO# ${invoiceNum} — House Party Distro`,
        html:
          `<p>Hi,</p>` +
          `<p>Please find the attached purchase order. Let us know if you have any questions or need clarification on any items.</p>` +
          `<p style="margin:16px 0"><a href="${BASE_URL()}/portal/vendor/preview" style="display:inline-block;padding:10px 24px;background:#4361ee;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold;font-size:13px">View in Vendor Portal</a></p>` +
          `<p>You can confirm receipt, update production status, and enter tracking directly from the portal.</p>` +
          `<p>Thanks,<br/>House Party Distro</p>` + DEMO_FOOTER,
        attachments: poPdf ? [{ filename: `HPD-PO-${invoiceNum}.pdf`, content: poPdf.toString("base64") }] : [],
      },
      // 11. Art intake (client-facing)
      {
        key: "art_intake",
        from: FROM_ADDR(),
        subject: `[PREVIEW] Sample brief — quick brief from House Party Distro`,
        html:
          `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:20px">` +
          `<div style="font-size:11px;color:#888;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">House Party Distro</div>` +
          `<h1 style="font-size:22px;margin:0 0 14px">Quick art brief — 2 minutes</h1>` +
          `<p style="font-size:14px;color:#444;line-height:1.5;margin:0 0 16px">Hi ${clientName},<br/><br/>` +
          `To kick off <strong>Sample Brief</strong>, we need a few things from you — what it's for, some reference images, and a vibe. Your link below is a permanent home for every art request we have in flight together, so you can come back any time.</p>` +
          `<a href="${artIntakePortalExample}" style="display:inline-block;padding:12px 24px;background:#222;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open your art requests →</a>` +
          `<p style="font-size:12px;color:#888;margin-top:20px">Bookmark this link. Every art request we have in motion for you lives here.</p>` +
          `</div>` + DEMO_FOOTER,
      },
      // 12. New art brief (designer-facing)
      {
        key: "new_art_brief",
        from: FROM_ADDR(),
        subject: `[PREVIEW] New art brief: Sample Brief`,
        html:
          `<div style="font-family:-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:20px">` +
          `<div style="font-size:11px;color:#888;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px">House Party Distro</div>` +
          `<h1 style="font-size:22px;margin:0 0 16px">New brief for ${clientName}</h1>` +
          `<p style="font-size:14px;color:#444;line-height:1.5"><strong>Sample Brief</strong> is ready for you to work on.</p>` +
          `<a href="${designerPortalExample}" style="display:inline-block;margin-top:14px;padding:12px 24px;background:#222;color:#fff;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">Open your dashboard →</a>` +
          `<p style="font-size:12px;color:#888;margin-top:20px">This link is permanent — bookmark it and come back anytime.</p>` +
          `</div>` + DEMO_FOOTER,
      },
      // 13. Daily digest (owner internal)
      {
        key: "daily_digest",
        from: FROM_ADDR(),
        subject: `[PREVIEW] OpsHub · 🟡 3 alerts — ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
        html:
          `<div style="font-family:sans-serif;max-width:600px">` +
          `<h2 style="margin:0 0 16px">OpsHub Daily Digest</h2>` +
          `<p style="color:#666;margin:0 0 20px">${new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} · 3 alerts</p>` +
          `<h3 style="color:#d97706;margin:16px 0 8px">Action Needed (3)</h3>` +
          `<ul style="margin:0;padding-left:20px">` +
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
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
