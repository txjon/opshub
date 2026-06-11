export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateCustomer, createInvoice, updateInvoice, QBAmbiguousCustomerError, getCustomerById, type QBLineItem } from "@/lib/quickbooks";

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

    const { reportId, forceCreate, qbCustomerId } = await req.json();
    if (!reportId) return NextResponse.json({ error: "Missing reportId" }, { status: 400 });
    // forceCreate: skip the ambiguous-match safety net and create a new
    //              QB customer (chooser "Create new" path).
    // qbCustomerId: caller has already picked an existing QB customer
    //               from the chooser; cache it on the client and use it.

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    const { data: report, error: reportErr } = await admin
      .from("shipstation_reports")
      .select("*, clients(id, name, qb_customer_id, default_terms, shipping_address, allow_cc, allow_ach)")
      .eq("id", reportId)
      .single();
    if (reportErr || !report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    const client = report.clients as any;
    const clientName = client?.name;
    if (!clientName) return NextResponse.json({ error: "No client name on report" }, { status: 400 });

    // Honor the client's online-payment preferences (set on the client
    // record). Mirrors the jobs invoice flow — e.g. ACH-only clients must
    // not get a credit-card option on the QB invoice. Defaults to true
    // when the flag is null/unset.
    const allowCC = client.allow_cc !== false;
    const allowACH = client.allow_ach !== false;

    const totals = report.totals || {};
    const isPostage = report.report_type === "postage";
    const isCombined = report.report_type === "combined";
    // Fulfillment-only — bill just the per-package fee (shipments × rate).
    // No sales fee, no postage line. Shipment count lives on totals.
    const isFulfillment = report.report_type === "fulfillment";
    // Bulk postage is a pure pass-through reimbursement — billed already
    // equals the total spent, fulfillment is 0, and the line description
    // drops the shipment-count / markup language.
    const isBulkPostage = (isPostage || isCombined) && (report as any).postage_mode === "bulk";
    // Per-half period labels — each line cites its own range; null falls
    // back to the invoice period. The memo keeps the invoice period.
    const salesPeriod = (report as any).sales_period_label || report.period_label;
    const postagePeriod = (report as any).postage_period_label || report.period_label;
    const perPackageFee = Number((report as any).per_package_fee) || 0;
    // Combined reports keep the postage half on the new postage_totals
    // column. Postage-only reports keep it on totals.
    const postageTotalsForBilling = isCombined
      ? ((report as any).postage_totals || {})
      : totals;
    const shipments = Number(postageTotalsForBilling.shipments) || 0;
    const fulfillmentAmount = (isPostage || isCombined || isFulfillment)
      ? Math.round(perPackageFee * shipments * 100) / 100
      : 0;
    // Sales line   → totals.fee
    // Postage line → totals.billed (single) or postage_totals.billed (combined)
    // Fulfillment  → perPackageFee × shipments (separate QB line so the
    //                client can verify $X × N against their packing slips)
    const postageBilled = (isPostage || isCombined)
      ? (Number(postageTotalsForBilling.billed) || 0)
      : 0;
    const salesFee = (isCombined || (!isPostage && !isCombined && !isFulfillment))
      ? (Number(totals.fee) || 0)
      : 0;
    const feeAmount = isCombined
      ? salesFee + postageBilled + fulfillmentAmount
      : isPostage
        ? postageBilled + fulfillmentAmount
        : isFulfillment
          ? fulfillmentAmount
          : Number(totals.fee) || 0;
    if (feeAmount <= 0) {
      return NextResponse.json({
        error: isCombined
          ? "Report has nothing to bill (sales fee + postage + fulfillment is zero or negative)"
          : isPostage
            ? "Report has nothing to bill (postage + fulfillment is zero or negative)"
            : isFulfillment
              ? "Report has no fulfillment fee to bill (per-package fee × shipments is zero). Set a per-package fee."
              : "Report has no HPD Fee to bill (totals.fee is zero or negative)",
      }, { status: 400 });
    }

    // QB customer — cache on clients.qb_customer_id like the jobs flow.
    // Lookup priority:
    //   1) Caller passed qbCustomerId (chooser → "Link to this one")
    //   2) Client already has cached qb_customer_id (validated active in QB)
    //   3) getOrCreateCustomer with smart match + ambiguous-error safety net
    let customerId: string | null = null;
    let healedFrom: string | null = null;
    if (qbCustomerId) {
      customerId = String(qbCustomerId);
      await admin.from("clients").update({ qb_customer_id: customerId }).eq("id", client.id);
    } else if (client.qb_customer_id) {
      // Validate the cached customer still exists + is active in QB. A
      // user can delete a customer in QB (e.g. cleaning up a duplicate
      // we accidentally created on a previous push), which would make
      // the next push 400 with "Invalid Customer ... has been deleted."
      // Self-heal: clear the stale cache + drop this report's invoice
      // refs (the invoice was tied to the now-dead customer) so we fall
      // through to the smart match and create a fresh invoice on the
      // correct customer.
      const cached = await getCustomerById(client.qb_customer_id);
      if (cached && cached.Active !== false) {
        customerId = client.qb_customer_id;
      } else {
        console.log(`[QB ShipStation] Cached qb_customer_id=${client.qb_customer_id} is missing or inactive — self-healing`);
        healedFrom = client.qb_customer_id;
        await admin.from("clients").update({ qb_customer_id: null }).eq("id", client.id);
        if ((report as any).qb_invoice_id) {
          await admin.from("shipstation_reports").update({
            qb_invoice_id: null,
            qb_invoice_number: null,
            qb_payment_link: null,
            qb_tax_amount: null,
            qb_total_with_tax: null,
            qb_invoice_created_at: null,
            qb_invoice_updated_at: null,
          }).eq("id", reportId);
          (report as any).qb_invoice_id = null;
          (report as any).qb_invoice_number = null;
          (report as any).qb_payment_link = null;
        }
      }
    }
    if (!customerId) {
      try {
        const customer = await getOrCreateCustomer(clientName, undefined, { forceCreate: !!forceCreate });
        customerId = customer.Id;
        await admin.from("clients").update({ qb_customer_id: customerId }).eq("id", client.id);
      } catch (e) {
        if (e instanceof QBAmbiguousCustomerError) {
          // Hand the chooser the candidates so the user can decide.
          return NextResponse.json({
            error: "ambiguous_customer",
            searchedName: e.searchedName,
            candidates: e.candidates.map((c: any) => ({
              id: c.Id,
              displayName: c.DisplayName,
              email: c.PrimaryEmailAddr?.Address || null,
              active: c.Active !== false,
            })),
            healed: healedFrom ? { previousCustomerId: healedFrom } : undefined,
          }, { status: 409 });
        }
        throw e;
      }
    }
    if (!customerId) {
      // Should be unreachable — every branch above either sets customerId or returns.
      return NextResponse.json({ error: "Could not resolve QuickBooks customer" }, { status: 500 });
    }

    // itemName must exist as a QB Product/Service; if not, QB
    // createInvoice falls back to item id "1" which may be wrong.
    // Sales line:        "Service Fee"
    // Postage line:      "Postage"
    // Fulfillment line:  "Fulfillment" (only when perPackageFee > 0)
    // Combined: all three apply on one invoice.
    const lineItems: QBLineItem[] = [];

    // Service Fee line — sales-only or combined (never fulfillment)
    if (isCombined || (!isPostage && !isCombined && !isFulfillment)) {
      const feePct = (Number(report.hpd_fee_pct) || 0) * 100;
      lineItems.push({
        description: `Product Sales Fulfillment — ${salesPeriod} (${feePct.toFixed(1)}% of $${Number(totals.net || 0).toFixed(2)} net sales)`,
        qty: 1,
        unitPrice: Math.round(salesFee * 100) / 100,
        itemName: "Service Fee",
      });
    }

    // Postage & Insurance line — postage-only or combined.
    // NOTE: never put the markup % in the client-facing description — that
    // exposes HPD's margin on the carrier cost. The shipment count stays so
    // the client can reconcile against their packing-slip count.
    if (isPostage || isCombined) {
      lineItems.push({
        description: isBulkPostage
          ? `Postage reimbursement — ${postagePeriod}`
          : `Postage & Insurance — ${postagePeriod} (${shipments.toFixed(0)} shipments)`,
        qty: 1,
        unitPrice: Math.round(postageBilled * 100) / 100,
        itemName: "Postage",
      });

      // Per-package fulfillment fee — separate line so QB invoice shows
      // the breakdown ($X × N shipments) the client can verify against
      // their packing-slip count.
      if (fulfillmentAmount > 0 && shipments > 0 && perPackageFee > 0) {
        lineItems.push({
          description: `Fulfillment Fee — ${postagePeriod} (per-package handling)`,
          qty: shipments,
          unitPrice: Math.round(perPackageFee * 100) / 100,
          itemName: "Fulfillment",
        });
      }
    }

    // Fulfillment-only line — the entire invoice. Client pays their own
    // postage, so there's no postage line; just $rate × N shipments.
    if (isFulfillment && fulfillmentAmount > 0 && shipments > 0 && perPackageFee > 0) {
      lineItems.push({
        description: `Fulfillment Fee — ${report.period_label} (per-package handling, ${shipments.toFixed(0)} shipments)`,
        qty: shipments,
        unitPrice: Math.round(perPackageFee * 100) / 100,
        itemName: "Fulfillment",
      });
    }

    const memo = isCombined
      ? `Full Service Invoice — ${report.period_label}`
      : isPostage
        ? `Postage Report — ${report.period_label}`
        : isFulfillment
          ? `Fulfillment Invoice — ${report.period_label}`
          : `Services Invoice — ${report.period_label}`;

    const shipAddr = client.shipping_address || undefined;
    const existingInvoiceId = report.qb_invoice_id;

    if (existingInvoiceId) {
      // Update path — same self-heal-payment-link behavior the jobs flow has.
      const updated = await updateInvoice(existingInvoiceId, lineItems, {
        memo,
        shipAddress: shipAddr,
        allowCC,
        allowACH,
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
        ...(healedFrom ? { healedFrom } : {}),
      });
    }

    // Create path
    const result = await createInvoice(customerId, lineItems, {
      terms: (client.default_terms as string) || undefined,
      memo,
      shipAddress: shipAddr,
      allowCC,
      allowACH,
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
      ...(healedFrom ? { healedFrom } : {}),
    });
  } catch (e: any) {
    console.error("[QB ShipStation Invoice Error]", e);
    return NextResponse.json({ error: e.message || "Failed to push to QuickBooks" }, { status: 500 });
  }
}
