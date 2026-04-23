export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateCustomer, createInvoice, updateInvoice, type QBLineItem } from "@/lib/quickbooks";

// Push a ShipStation Sales Report to QuickBooks as a single-line
// service-fee invoice. Mirrors /api/qb/invoice but sourced from
// shipstation_reports rather than jobs + items. Same create/update +
// self-heal-payment-link pattern.
//
// The single line billed to the client is "Service Fee" × 1 at
// report.totals.fee (i.e., the HPD Fee carved out of Product Net).

export async function POST(req: NextRequest) {
  try {
    const internalKey = req.headers.get("x-internal-key");
    let userId: string | null = null;
    if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      userId = user.id;
    }

    const { reportId } = await req.json();
    if (!reportId) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: report, error: reportErr } = await admin
      .from("shipstation_reports")
      .select("*, clients(id, name, qb_customer_id, default_terms, shipping_address)")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const client = report.clients as any;
    const clientName = client?.name;
    if (!clientName) return NextResponse.json({ error: "No client name on report" }, { status: 400 });

    const totals = report.totals || {};
    const feeAmount = Number(totals.fee) || 0;
    if (feeAmount <= 0) {
      return NextResponse.json({ error: "Report has no HPD Fee to bill (totals.fee is zero or negative)" }, { status: 400 });
    }

    // QB customer — cache on clients.qb_customer_id like the jobs flow.
    let customerId: string;
    if (client.qb_customer_id) {
      customerId = client.qb_customer_id;
    } else {
      const customer = await getOrCreateCustomer(clientName, undefined);
      customerId = customer.Id;
      await admin.from("clients").update({ qb_customer_id: customerId }).eq("id", client.id);
    }

    // Single service-fee line. itemName "Service Fee" must exist as a QB
    // Product/Service; if it doesn't, QB createInvoice falls back to item
    // id "1" which may be wrong. If this ever becomes a problem, create
    // "Service Fee" (Type: Service) in QB Products & Services.
    const lineItems: QBLineItem[] = [{
      description: `Product Sales Fulfillment — ${report.period_label} (${((Number(report.hpd_fee_pct) || 0) * 100).toFixed(1)}% of $${Number(totals.net || 0).toFixed(2)} net sales)`,
      qty: 1,
      unitPrice: Math.round(feeAmount * 100) / 100,
      itemName: "Service Fee",
    }];

    const shipAddr = client.shipping_address || undefined;
    const existingInvoiceId = report.qb_invoice_id;

    if (existingInvoiceId) {
      // Update path — same self-heal-payment-link behavior the jobs flow has.
      const updated = await updateInvoice(existingInvoiceId, lineItems, {
        memo: `Product Sales Report — ${report.period_label}`,
        shipAddress: shipAddr,
      });

      const prevLink: string = report.qb_payment_link || "";
      const linkBroken = prevLink.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
      const healedLink = updated.paymentLink && (linkBroken || !prevLink) ? updated.paymentLink : prevLink;

      await admin.from("shipstation_reports").update({
        qb_tax_amount: updated.taxAmount,
        qb_total_with_tax: updated.totalWithTax,
        qb_invoice_updated_at: new Date().toISOString(),
        ...(healedLink !== prevLink ? { qb_payment_link: healedLink } : {}),
      }).eq("id", reportId);

      return NextResponse.json({
        success: true,
        updated: true,
        invoiceId: existingInvoiceId,
        invoiceNumber: report.qb_invoice_number,
        paymentLink: healedLink,
      });
    }

    // Create path
    const result = await createInvoice(customerId, lineItems, {
      terms: (client.default_terms as string) || undefined,
      memo: `Product Sales Report — ${report.period_label}`,
      shipAddress: shipAddr,
    });

    await admin.from("shipstation_reports").update({
      qb_invoice_id: result.invoiceId,
      qb_invoice_number: result.invoiceNumber,
      qb_payment_link: result.paymentLink,
      qb_tax_amount: result.taxAmount,
      qb_total_with_tax: result.totalWithTax,
      qb_invoice_created_at: new Date().toISOString(),
    }).eq("id", reportId);

    return NextResponse.json({
      success: true,
      updated: false,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      paymentLink: result.paymentLink,
    });
  } catch (e: any) {
    console.error("[QB ShipStation Invoice Error]", e);
    return NextResponse.json({ error: e.message || "Failed to push to QuickBooks" }, { status: 500 });
  }
}
