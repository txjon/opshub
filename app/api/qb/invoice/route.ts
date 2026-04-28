export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateCustomer, createInvoice, updateInvoice, type QBLineItem } from "@/lib/quickbooks";
// Note: logs to job_activity after push so dashboard actions are traceable
// Pricing source of truth: items.sell_per_unit (set by CostingTab, rounded to cent)

// Garment type → QB Product/Service name mapping
const QB_PRODUCT_MAP: Record<string, string> = {
  tee: "Tees", longsleeve: "Tees", hoodie: "Hoodies", crewneck: "Crewneck",
  jacket: "Jacket", pants: "Pants", shorts: "Shorts", hat: "Hats",
  beanie: "Beanie", tote: "Tote", patch: "Patches", poster: "Posters",
  sticker: "Stickers", custom: "Custom", socks: "Socks", bandana: "Bandanas",
  banner: "Banner", flag: "Flags", pin: "Pins", koozie: "Koozie",
  lighter: "Lighter", can_cooler: "Can Cooler", key_chain: "Key Chain",
  custom_bag: "Custom Bag", pillow: "Pillow", rug: "Rug", towel: "Towel",
  water_bottle: "Water Bottle", pens: "Pens", napkins: "Napkins",
  woven_labels: "Woven Labels", balloons: "Balloons", stencils: "Stencils",
  samples: "Samples",
};

export async function POST(req: NextRequest) {
  try {
    // Auth check — logged-in user OR internal service call
    const internalKey = req.headers.get("x-internal-key");
    let userId: string | null = null;
    if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      userId = user.id;
    }

    const { jobId, useShippedQtys, billableQtys } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });
    // billableQtys: optional Record<itemId, totalQty> — variance review override (per-line edit/waive)

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Load job + items + client shipping address
    const { data: job } = await admin.from("jobs").select("*, clients(name, default_terms, shipping_address, allow_cc, allow_ach)").eq("id", jobId).single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const { data: items } = await admin.from("items")
      .select("*, buy_sheet_lines(size, qty_ordered)")
      .eq("job_id", jobId)
      .order("sort_order");

    // Get primary contact email
    const { data: contacts } = await admin.from("job_contacts")
      .select("*, contacts(email)")
      .eq("job_id", jobId);
    const primaryEmail = contacts?.find((jc: any) => jc.role_on_job === "primary")?.contacts?.email;

    // Get or create QB customer
    const clientName = (job.clients as any)?.name;
    if (!clientName) return NextResponse.json({ error: "No client name" }, { status: 400 });

    // Check if client has a cached QB customer ID
    const { data: clientRecord } = await admin.from("clients").select("id, qb_customer_id").eq("name", clientName).single();
    let customerId: string;

    if (clientRecord?.qb_customer_id) {
      customerId = clientRecord.qb_customer_id;
    } else {
      const customer = await getOrCreateCustomer(clientName, primaryEmail || undefined);
      customerId = customer.Id;
      // Cache the QB customer ID
      if (clientRecord) {
        await admin.from("clients").update({ qb_customer_id: customerId }).eq("id", clientRecord.id);
      }
    }

    // items.sell_per_unit is the source of truth — set by CostingTab, rounded to cent
    // useShippedQtys: use best-available qty (received_qtys → ship_qtys → ordered) with
    // priority flipped by shipping route. Drop-ship prefers decorator-reported ship_qtys;
    // ship_through/stage prefer HPD's received_qtys (warehouse confirmed).
    const prefersReceived = (job as any).shipping_route === "ship_through" || (job as any).shipping_route === "stage";
    const lineItems: QBLineItem[] = [];

    for (const item of (items || [])) {
      const lines = (item as any).buy_sheet_lines || [];
      const received = ((item as any).received_qtys || {}) as Record<string, number>;
      const shipped = ((item as any).ship_qtys || {}) as Record<string, number>;
      const firstChoice = prefersReceived ? received : shipped;
      const secondChoice = prefersReceived ? shipped : received;

      const perSize: Record<string, number> = {};
      for (const l of lines) {
        if (useShippedQtys) {
          const fromFirst = firstChoice[l.size];
          const fromSecond = secondChoice[l.size];
          const fromOrdered = l.qty_ordered || 0;
          // Missing sizes fall through to ordered — matches packing slip + variance.
          perSize[l.size] = fromFirst !== undefined
            ? fromFirst
            : fromSecond !== undefined
            ? fromSecond
            : fromOrdered;
        } else {
          perSize[l.size] = l.qty_ordered || 0;
        }
      }
      let totalQty = Object.values(perSize).reduce((a, q) => a + (q || 0), 0);

      // Override with billableQty if variance reviewer set one (waived or manual edit)
      if (billableQtys && (item as any).id in billableQtys) {
        const override = Number(billableQtys[(item as any).id]);
        if (!isNaN(override) && override >= 0) totalQty = Math.floor(override);
      }

      if (totalQty === 0) continue;

      const sellPerUnit = parseFloat((item as any).sell_per_unit) || 0;
      const garmentType = (item as any).garment_type || "custom";
      const qbProductName = QB_PRODUCT_MAP[garmentType] || "Custom";

      // Build description like QB screenshot: name / vendor / color + sizes
      const sizes = Object.entries(perSize)
        .filter(([, q]) => q > 0)
        .sort((a, b) => {
          const order = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];
          return (order.indexOf(a[0]) === -1 ? 99 : order.indexOf(a[0])) - (order.indexOf(b[0]) === -1 ? 99 : order.indexOf(b[0]));
        })
        .map(([size, q]) => `${size} ${q}`);

      const descParts = [(item as any).name];
      if ((item as any).blank_vendor) descParts.push((item as any).blank_vendor);
      if ((item as any).blank_sku) descParts.push((item as any).blank_sku);
      const description = descParts.join(" / ") + "\n" + sizes.join(" • ");

      lineItems.push({
        description,
        qty: totalQty,
        unitPrice: sellPerUnit,
        itemName: qbProductName,
      });
    }

    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No items with quantities" }, { status: 400 });
    }

    const existingInvoiceId = job.type_meta?.qb_invoice_id;

    const shipAddr = (job.type_meta as any)?.venue_address
      || (job.clients as any)?.shipping_address || undefined;

    // Per-client payment-method flags. Default true if columns are
    // unset (e.g., migration hasn't been applied yet) — preserves the
    // pre-flag behavior.
    const clientRow = (job.clients as any) || {};
    const allowCC = clientRow.allow_cc !== false;
    const allowACH = clientRow.allow_ach !== false;

    if (existingInvoiceId) {
      // Update existing QB invoice
      const updated = await updateInvoice(existingInvoiceId, lineItems, {
        memo: `${job.title} — ${job.job_number}`,
        shipAddress: shipAddr,
        email: primaryEmail || undefined,
        allowCC,
        allowACH,
      });

      // Update tax/total in type_meta. Also record variance-finalized timestamp
      // when this update came from the shipped-qty variance review flow, so the
      // UI knows the "pricing changed" staleness check is no longer meaningful
      // (post-variance, qb total reflects shipped qtys, not costing grossRev).
      //
      // Always take the freshest payment link QB gives us back. Revisions
      // can change the InvoiceLink, and any stored link that starts with
      // /app/invoices/pay is the legacy admin URL (404s for customers).
      // Only fall back to the previous link if QB returned nothing.
      const prevLink: string = (job.type_meta as any)?.qb_payment_link || "";
      const healedLink = updated.paymentLink || prevLink;

      await admin.from("jobs").update({
        type_meta: {
          ...(job.type_meta || {}),
          qb_tax_amount: updated.taxAmount,
          qb_total_with_tax: updated.totalWithTax,
          qb_invoice_updated_at: new Date().toISOString(),
          ...(healedLink !== prevLink ? { qb_payment_link: healedLink } : {}),
          ...(useShippedQtys ? {
            qb_variance_pushed_at: new Date().toISOString(),
            qb_variance_total: updated.totalWithTax,
            qb_variance_tax: updated.taxAmount,
            ...(billableQtys ? { qb_variance_billable_qtys: billableQtys } : {}),
          } : {}),
        },
      }).eq("id", jobId);

      // No auto-email on update. The user reviews and triggers any
      // client-facing send via the Send Invoice button (first send or
      // revised). Same producer-side review pattern as the portal gate
      // and the Invoice Drafted vs Invoice Sent split.

      // Log activity
      await admin.from("job_activity").insert({
        job_id: jobId, user_id: userId, type: "auto",
        message: `Invoice updated in QuickBooks — #${job.type_meta?.qb_invoice_number || "pending"} · $${updated.totalWithTax?.toFixed(2) || "?"}`,
      });

      return NextResponse.json({
        success: true,
        updated: true,
        invoiceId: existingInvoiceId,
        invoiceNumber: job.type_meta?.qb_invoice_number,
        paymentLink: healedLink,
      });
    }

    // Create new invoice in QB
    const result = await createInvoice(customerId, lineItems, {
      terms: job.payment_terms || undefined,
      memo: `${job.title} — ${job.job_number}`,
      email: primaryEmail || undefined,
      shipAddress: shipAddr,
      allowCC,
      allowACH,
    });

    // Save QB invoice data to job
    await admin.from("jobs").update({
      type_meta: {
        ...(job.type_meta || {}),
        qb_invoice_id: result.invoiceId,
        qb_invoice_number: result.invoiceNumber,
        qb_payment_link: result.paymentLink,
        qb_tax_amount: result.taxAmount,
        qb_total_with_tax: result.totalWithTax,
        qb_invoice_created_at: new Date().toISOString(),
      },
    }).eq("id", jobId);

    // Log activity
    await admin.from("job_activity").insert({
      job_id: jobId, user_id: userId, type: "auto",
      message: `Invoice pushed to QuickBooks — #${result.invoiceNumber} · $${result.totalWithTax?.toFixed(2) || "?"}`,
    });

    return NextResponse.json({
      success: true,
      invoiceId: result.invoiceId,
      invoiceNumber: result.invoiceNumber,
      paymentLink: result.paymentLink,
    });
  } catch (e: any) {
    console.error("[QB Invoice Error]", e);
    return NextResponse.json({ error: e.message || "Failed to create QB invoice" }, { status: 500 });
  }
}
