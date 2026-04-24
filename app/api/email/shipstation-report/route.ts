export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { renderBrandedEmail } from "@/lib/email-template";
import { refreshPaymentLink } from "@/lib/quickbooks";

// Send a generated ShipStation Sales Report to the client as a branded
// email with the PDF attached + Pay Online button (if the report has
// been pushed to QB). Mirrors /api/email/send (type=invoice) but
// sourced from shipstation_reports.

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const resend = new Resend(process.env.RESEND_API_KEY);
    const { reportId, recipientEmail, ccEmails, recipientName, subject, customBody } = await req.json();

    if (!reportId || !recipientEmail) {
      return NextResponse.json({ error: "Missing reportId or recipientEmail" }, { status: 400 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_SITE_URL
      || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { data: report, error } = await admin
      .from("shipstation_reports")
      .select("*, clients(name, portal_token, client_hub_enabled)")
      .eq("id", reportId)
      .single();
    if (error || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    // Self-heal payment link if the QB invoice exists but the stored link
    // is missing or legacy. Same pattern as the jobs invoice email flow.
    let paymentLink: string = report.qb_payment_link || "";
    if (report.qb_invoice_id) {
      const isLegacy = paymentLink.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
      if (!paymentLink || isLegacy) {
        try {
          const fresh = await refreshPaymentLink(String(report.qb_invoice_id));
          if (fresh && fresh !== paymentLink) {
            paymentLink = fresh;
            await admin.from("shipstation_reports").update({ qb_payment_link: fresh }).eq("id", reportId);
          }
        } catch (e) {
          console.error("[email/shipstation-report] refreshPaymentLink failed:", (e as any).message);
        }
      }
    }

    // Fetch the PDF by calling our own PDF route with the service role key.
    const pdfRes = await fetch(`${baseUrl}/api/pdf/shipstation/${reportId}?download=1`, {
      headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "" },
    });
    if (!pdfRes.ok) {
      const text = await pdfRes.text();
      return NextResponse.json({ error: `PDF generation failed: ${text}` }, { status: 500 });
    }
    const pdfBuffer = Buffer.from(await pdfRes.arrayBuffer());

    const clientName = (report.clients as any)?.name || "—";
    const greetingName = recipientName ? recipientName.split(" ")[0] : clientName;
    const invoiceNum = report.qb_invoice_number || "";
    const isPostage = report.report_type === "postage";
    const reportKind = isPostage ? "Fulfillment Invoice" : "Product Sales Report";
    const slug = (clientName + "-" + report.period_label).replace(/\s+/g, "-").replace(/[^a-zA-Z0-9-]/g, "");
    const pdfFilename = `HPD-${isPostage ? "Fulfillment-Invoice" : "Sales-Report"}-${slug}.pdf`;

    // For postage reports, also fetch the shipment-level xlsx so the
    // client has the full raw data alongside the invoice summary.
    let xlsxBuffer: Buffer | null = null;
    let xlsxFilename = "";
    if (isPostage) {
      const xlsxRes = await fetch(`${baseUrl}/api/excel/shipstation/${reportId}`, {
        headers: { "x-internal-key": process.env.SUPABASE_SERVICE_ROLE_KEY || "" },
      });
      if (xlsxRes.ok) {
        xlsxBuffer = Buffer.from(await xlsxRes.arrayBuffer());
        xlsxFilename = `HPD-Fulfillment-Shipments-${slug}.xlsx`;
      } else {
        const text = await xlsxRes.text();
        console.error("[email/shipstation-report] xlsx generation failed:", text);
      }
    }

    const fromAddress = process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev";
    const defaultSubject = subject || `${reportKind} — ${clientName} · ${report.period_label}${invoiceNum ? ` · Invoice ${invoiceNum}` : ""}`;

    // If the client is on the Client Hub, add a "View in Portal" CTA so they
    // can see all their fulfillment invoices + pay status in one place.
    // Fulfillment invoices only surface on the Client Hub Orders tab — the
    // old per-job portal can't render them — so non-hub clients don't get
    // a portal CTA here.
    const hubClient = (report.clients as any) || {};
    const portalUrl = hubClient.client_hub_enabled && hubClient.portal_token
      ? `${(process.env.NEXT_PUBLIC_SITE_URL || "https://app.housepartydistro.com")}/portal/client/${hubClient.portal_token}/orders`
      : "";

    const { data, error: sendErr } = await resend.emails.send({
      from: fromAddress,
      to: recipientEmail,
      ...(ccEmails?.length > 0 ? { cc: ccEmails } : {}),
      subject: defaultSubject,
      html: renderBrandedEmail({
        heading: `${reportKind} — ${report.period_label}`,
        greeting: `Hi ${greetingName},`,
        bodyHtml: customBody
          || (isPostage
            ? `Attached is your fulfillment invoice for <strong>${report.period_label}</strong>${invoiceNum ? ` — Invoice #${invoiceNum}` : ""}. The PDF summarizes the amount due; the accompanying spreadsheet itemizes every shipment with carrier cost and insurance.`
            : `Attached is your product sales report for <strong>${report.period_label}</strong>${invoiceNum ? ` — billed on Invoice #${invoiceNum}` : ""}. The report covers total units sold, product sales, cost of goods, and your net profit after the HPD fulfillment fee.`),
        cta: paymentLink ? { label: "Pay Online", url: paymentLink, style: "green" } : undefined,
        secondaryCta: portalUrl ? { label: "View in Portal", url: portalUrl } : undefined,
      }),
      attachments: [
        { filename: pdfFilename, content: pdfBuffer.toString("base64") },
        ...(xlsxBuffer ? [{ filename: xlsxFilename, content: xlsxBuffer.toString("base64") }] : []),
      ],
    });

    if (sendErr) {
      return NextResponse.json({ error: sendErr.message }, { status: 500 });
    }

    // Persist the send so the detail page can show status.
    const recipientsList = [recipientEmail, ...(ccEmails || [])];
    await admin.from("shipstation_reports").update({
      sent_at: new Date().toISOString(),
      sent_to: recipientsList,
    }).eq("id", reportId);

    return NextResponse.json({ success: true, id: data?.id });
  } catch (e: any) {
    console.error("[email/shipstation-report]", e);
    return NextResponse.json({ error: e.message || "Send failed" }, { status: 500 });
  }
}
