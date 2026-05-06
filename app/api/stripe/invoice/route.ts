import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company";
import { findOrCreateCustomer, createAndSendInvoice, getStripeClient, type StripeLineItem } from "@/lib/stripe";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST /api/stripe/invoice
// Body: { jobId: string }
//
// Mirrors /api/qb/invoice but for Stripe-backed companies (IHM at
// launch). Pulls the job + items + billing contact, creates a Stripe
// customer if needed, creates and finalizes the invoice, sends it
// (which mints the hosted_invoice_url), and writes the invoice id +
// number + pay link back onto jobs.type_meta.
//
// Pricing source of truth: items.sell_per_unit (same as QB path —
// set by CostingTab, already rounded to the cent). No recalculation.
//
// Re-runs on the same job UPDATE the existing Stripe invoice instead
// of creating a new one — Stripe rejects re-finalizing a sent invoice
// so this only updates description/metadata; line item changes after
// the first send require voiding and re-creating, which is a Phase 2
// enhancement (rare in practice for this flow).

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const company = await getActiveCompany();
    if (company.default_payment_provider !== "stripe") {
      return NextResponse.json(
        { error: `This company (${company.slug}) is configured for ${company.default_payment_provider}, not Stripe` },
        { status: 400 }
      );
    }

    const { jobId } = await req.json();
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

    // Pull job + client + billing/primary contact + items
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, job_number, payment_terms, target_ship_date, type_meta, client_id, clients(id, name), items(id, name, garment_type, mockup_color, sell_per_unit, blank_vendor, buy_sheet_lines(size, qty_ordered)), job_contacts(role_on_job, contacts(id, name, email))")
      .eq("id", jobId)
      .single();
    if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const client = (job as any).clients;
    if (!client) return NextResponse.json({ error: "Job has no client" }, { status: 400 });

    // Pick billing contact, fall back to primary, fall back to first
    const jcs: any[] = (job as any).job_contacts || [];
    const billing = jcs.find(j => j.role_on_job === "billing")?.contacts
      || jcs.find(j => j.role_on_job === "primary")?.contacts
      || jcs[0]?.contacts;
    if (!billing?.email) {
      return NextResponse.json({ error: "No billing contact with email on this job" }, { status: 400 });
    }

    // Build Stripe line items from the job's items
    const lineItems: StripeLineItem[] = [];
    for (const item of ((job as any).items || [])) {
      const sellPerUnit = parseFloat(item.sell_per_unit) || 0;
      if (sellPerUnit <= 0) continue;
      const totalQty = (item.buy_sheet_lines || []).reduce((a: number, l: any) => a + (Number(l.qty_ordered) || 0), 0);
      if (totalQty <= 0) continue;
      const sizes = (item.buy_sheet_lines || []).map((l: any) => `${l.size}:${l.qty_ordered}`).join(", ");
      const descParts = [item.name];
      if (item.blank_vendor) descParts.push(item.blank_vendor);
      if (item.mockup_color) descParts.push(item.mockup_color);
      if (sizes) descParts.push(sizes);
      lineItems.push({
        description: descParts.filter(Boolean).join(" / "),
        quantity: totalQty,
        unit_amount_cents: Math.round(sellPerUnit * 100),
      });
    }
    if (lineItems.length === 0) {
      return NextResponse.json({ error: "No items with sell_per_unit > 0 on this job" }, { status: 400 });
    }

    // Find or create the Stripe customer for this client
    const stripe = getStripeClient(company.slug);
    const customer = await findOrCreateCustomer(stripe, {
      name: client.name,
      email: billing.email,
      externalId: client.id,
    });

    // Read per-client payment method preferences (same toggles as QB)
    const { data: clientRow } = await supabase
      .from("clients")
      .select("allow_cc, allow_ach")
      .eq("id", client.id)
      .single();

    const tm = (job as any).type_meta || {};
    const existingInvoiceId = tm.stripe_invoice_id;

    // Currently re-pushing only updates description; line items on a
    // sent invoice can't be edited via the API. Stripe enforces this.
    // For now, surface a clear error if the user re-pushes — they need
    // to void the old invoice in Stripe Dashboard first if items changed.
    if (existingInvoiceId) {
      try {
        const existing = await stripe.invoices.retrieve(existingInvoiceId);
        await supabase.from("job_activity").insert({
          job_id: job.id, user_id: user.id, type: "auto",
          message: `Stripe invoice already exists (#${existing.number || "draft"}) — refresh from Stripe Dashboard if line items changed`,
        });
        return NextResponse.json({
          invoiceId: existing.id,
          invoiceNumber: existing.number,
          hostedUrl: existing.hosted_invoice_url,
          totalCents: existing.total,
          status: existing.status,
          alreadyExists: true,
        });
      } catch {
        // Invoice was deleted / voided in Stripe — fall through to recreate
      }
    }

    const result = await createAndSendInvoice(stripe, {
      customerId: customer.id,
      lineItems,
      dueDate: job.target_ship_date || null,
      description: `Project: ${job.title}${job.job_number ? ` (${job.job_number})` : ""}`,
      allowCard: (clientRow as any)?.allow_cc !== false,
      allowAch: (clientRow as any)?.allow_ach !== false,
    });

    // Persist invoice ids onto jobs.type_meta
    const newMeta = {
      ...tm,
      stripe_invoice_id: result.invoice_id,
      stripe_invoice_number: result.invoice_number,
      stripe_payment_link: result.hosted_invoice_url,
      stripe_total_cents: result.total_cents,
      stripe_invoice_status: result.status,
      stripe_customer_id: customer.id,
    };
    await supabase.from("jobs").update({ type_meta: newMeta }).eq("id", job.id);

    // Cache the Stripe customer id on clients for future invoice pushes
    if (!(clientRow as any)?.stripe_customer_id) {
      // The clients table will need a stripe_customer_id column — see mig 063 below.
      // For now, falling through silently since we already wrote it to type_meta.
    }

    await supabase.from("job_activity").insert({
      job_id: job.id, user_id: user.id, type: "auto",
      message: `Invoice pushed to Stripe — #${result.invoice_number} · $${(result.total_cents / 100).toFixed(2)}`,
    });

    return NextResponse.json({
      invoiceId: result.invoice_id,
      invoiceNumber: result.invoice_number,
      hostedUrl: result.hosted_invoice_url,
      totalCents: result.total_cents,
      status: result.status,
    });
  } catch (e: any) {
    console.error("[stripe/invoice]", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
