export const runtime = "nodejs";
export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getOrCreateCustomer, createInvoice, updateInvoice, type QBLineItem } from "@/lib/quickbooks";

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
    if (internalKey !== process.env.SUPABASE_SERVICE_ROLE_KEY) {
      const supabase = await createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: "Missing jobId" }, { status: 400 });

    const admin = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

    // Load job + items + client shipping address
    const { data: job } = await admin.from("jobs").select("*, clients(name, default_terms, shipping_address)").eq("id", jobId).single();
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

    // Build line items from costing_data (source of truth for pricing)
    const costProds: any[] = job.costing_data?.costProds || [];
    const costingSummary = job.costing_summary || {};
    const lineItems: QBLineItem[] = [];

    for (const item of (items || [])) {
      const lines = item.buy_sheet_lines || [];
      const totalQty = lines.reduce((a: number, l: any) => a + (l.qty_ordered || 0), 0);
      if (totalQty === 0) continue;

      // Use costing_data sellOverride as primary, then costing_summary-derived, then items table fallback
      const cp = costProds.find((p: any) => p.id === item.id);
      let sellPerUnit = 0;
      if (cp?.sellOverride) {
        sellPerUnit = cp.sellOverride;
      } else if (costingSummary.grossRev && costingSummary.totalQty) {
        // No override — use the auto-calculated price from costing summary
        sellPerUnit = item.sell_per_unit || 0;
      } else {
        sellPerUnit = item.sell_per_unit || 0;
      }
      const garmentType = item.garment_type || "custom";
      const qbProductName = QB_PRODUCT_MAP[garmentType] || "Custom";

      // Build description like QB screenshot: name / vendor / color + sizes
      const sizes = lines
        .filter((l: any) => l.qty_ordered > 0)
        .sort((a: any, b: any) => {
          const order = ["XS","S","M","L","XL","2XL","3XL","4XL","5XL","6XL"];
          return (order.indexOf(a.size) === -1 ? 99 : order.indexOf(a.size)) - (order.indexOf(b.size) === -1 ? 99 : order.indexOf(b.size));
        })
        .map((l: any) => `${l.size} ${l.qty_ordered}`);

      const descParts = [item.name];
      if (item.blank_vendor) descParts.push(item.blank_vendor);
      if (item.blank_sku) descParts.push(item.blank_sku);
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

    if (existingInvoiceId) {
      // Update existing QB invoice
      const updated = await updateInvoice(existingInvoiceId, lineItems, {
        memo: `${job.title} — ${job.job_number}`,
      });

      // Update tax/total in type_meta
      await admin.from("jobs").update({
        type_meta: {
          ...(job.type_meta || {}),
          qb_tax_amount: updated.taxAmount,
          qb_total_with_tax: updated.totalWithTax,
          qb_invoice_updated_at: new Date().toISOString(),
        },
      }).eq("id", jobId);

      return NextResponse.json({
        success: true,
        updated: true,
        invoiceNumber: job.type_meta?.qb_invoice_number,
        paymentLink: job.type_meta?.qb_payment_link,
      });
    }

    // Create new invoice in QB
    const shipAddr = (job.clients as any)?.shipping_address
      || (job.type_meta as any)?.venue_address || undefined;
    const result = await createInvoice(customerId, lineItems, {
      terms: job.payment_terms || undefined,
      memo: `${job.title} — ${job.job_number}`,
      email: primaryEmail || undefined,
      shipAddress: shipAddr,
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

    return NextResponse.json({
      success: true,
      invoiceNumber: result.invoiceNumber,
      paymentLink: result.paymentLink,
    });
  } catch (e: any) {
    console.error("[QB Invoice Error]", e);
    return NextResponse.json({ error: e.message || "Failed to create QB invoice" }, { status: 500 });
  }
}
