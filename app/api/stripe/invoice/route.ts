import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveCompany } from "@/lib/company";
import { findOrCreateCustomer, createAndSendInvoice, voidInvoice, getStripeClient, type StripeLineItem } from "@/lib/stripe";
import { deductSamples } from "@/lib/qty";

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

    const { jobId, useShippedQtys, billableQtys } = await req.json();
    if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });
    // useShippedQtys → variance flow: bill received→shipped→ordered qtys (minus
    // samples) and replace the existing invoice. billableQtys → optional per-item
    // total overrides (waive / manual edit) from the variance review screen.
    const isVariance = !!useShippedQtys;

    // Pull job + client + billing/primary contact + items
    const { data: job } = await supabase
      .from("jobs")
      .select("id, title, job_number, payment_terms, target_ship_date, shipping_route, type_meta, client_id, clients(id, name), items(id, name, garment_type, mockup_color, sell_per_unit, blank_vendor, shipping_route, ship_qtys, received_qtys, sample_qtys, buy_sheet_lines(size, qty_ordered)), job_contacts(role_on_job, contacts(id, name, email))")
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

    // Build Stripe line items. Ordered qtys by default; the variance flow bills
    // actual received→shipped→ordered qtys (minus samples), with optional
    // per-item billable overrides from the review screen. Mirrors /api/qb/invoice.
    const lineItems: StripeLineItem[] = [];
    for (const item of ((job as any).items || [])) {
      const sellPerUnit = parseFloat(item.sell_per_unit) || 0;
      if (sellPerUnit <= 0) continue;
      const lines = item.buy_sheet_lines || [];

      const perSize: Record<string, number> = {};
      if (isVariance) {
        const received = (item.received_qtys || {}) as Record<string, number>;
        const shipped = (item.ship_qtys || {}) as Record<string, number>;
        // Per-item route wins over the job route (migration 076).
        const itemRoute = item.shipping_route || (job as any).shipping_route;
        const prefersReceived = itemRoute === "ship_through" || itemRoute === "stage";
        const firstChoice = prefersReceived ? received : shipped;
        const secondChoice = prefersReceived ? shipped : received;
        for (const l of lines) {
          const a = firstChoice[l.size];
          const b = secondChoice[l.size];
          // Missing sizes fall through to ordered — matches QB variance + packing slip.
          perSize[l.size] = a !== undefined ? a : b !== undefined ? b : (Number(l.qty_ordered) || 0);
        }
      } else {
        for (const l of lines) perSize[l.size] = Number(l.qty_ordered) || 0;
      }
      // Samples are pulled at HPD and never ship to the customer — don't bill them.
      const billable = isVariance ? deductSamples(perSize, item.sample_qtys) : perSize;

      let totalQty = Object.values(billable).reduce((a, q) => a + (q || 0), 0);
      // Per-item billable override (waive / manual edit) from the variance review.
      if (isVariance && billableQtys && item.id in billableQtys) {
        const override = Number(billableQtys[item.id]);
        if (!isNaN(override) && override >= 0) totalQty = Math.floor(override);
      }
      if (totalQty <= 0) continue;

      const sizes = Object.entries(billable).filter(([, q]) => (q || 0) > 0).map(([s, q]) => `${s}:${q}`).join(", ");
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
    // Variance flow voids the prior invoice AFTER the replacement exists (see the
    // save block below) so the invoice.voided webhook — which matches a job by
    // stripe_invoice_id — finds no job once we've repointed, avoiding a clobber race.
    let voidAfter: { id: string; status: string } | null = null;

    // Re-push handling: line items on a finalized invoice can't be edited via the
    // API (Stripe enforces this), so any "update" means void + recreate.
    //   • Variance (useShippedQtys): recreate from shipped qtys; block if the
    //     prior invoice is already paid/uncollectible; otherwise queue it for
    //     void after the replacement is created.
    //   • Plain re-push: recreate only if the prior invoice is void/missing;
    //     otherwise return early (line items changed → void in Dashboard first).
    if (existingInvoiceId) {
      try {
        const existing = await stripe.invoices.retrieve(existingInvoiceId);
        if (isVariance) {
          if (existing.status === "paid" || existing.status === "uncollectible") {
            return NextResponse.json({
              error: "This invoice is already paid — it can't be revised here. Crediting an overbill or charging a shortfall is a manual step for now.",
            }, { status: 409 });
          }
          if (existing.status === "open" || existing.status === "draft") {
            voidAfter = { id: existing.id!, status: existing.status };
          }
          // already void → nothing to retire; just recreate.
        } else if (existing.status === "void") {
          await supabase.from("job_activity").insert({
            job_id: job.id, user_id: user.id, type: "auto",
            message: `Voided Stripe invoice ${existing.number || existingInvoiceId} — creating a fresh invoice`,
          });
          // Fall through to recreate below.
        } else {
          await supabase.from("job_activity").insert({
            job_id: job.id, user_id: user.id, type: "auto",
            message: `Stripe invoice already exists (#${existing.number || "draft"}, ${existing.status}) — void in Stripe Dashboard before re-pushing`,
          });
          return NextResponse.json({
            invoiceId: existing.id,
            invoiceNumber: existing.number,
            hostedUrl: existing.hosted_invoice_url,
            totalCents: existing.total,
            status: existing.status,
            alreadyExists: true,
          });
        }
      } catch {
        // Invoice was deleted in Stripe — fall through to recreate.
      }
    }

    const result = await createAndSendInvoice(stripe, {
      customerId: customer.id,
      lineItems,
      dueDate: job.target_ship_date || null,
      description: `Project: ${job.title}${job.job_number ? ` (${job.job_number})` : ""}`,
      allowCard: (clientRow as any)?.allow_cc !== false,
      allowAch: (clientRow as any)?.allow_ach !== false,
      // Use the OpsHub job number as the Stripe invoice number so the
      // same identifier appears in OpsHub, on the PDF, and in Stripe's
      // dashboard. Requires Manual Invoice Numbering on the Stripe
      // account; if disabled Stripe ignores the override silently and
      // falls back to its auto-generated number.
      customNumber: (job as any).job_number || null,
    });

    // Persist invoice ids onto jobs.type_meta. Variance: stamp the flag (so the
    // PDF + portal switch to shipped qtys) and store the billable overrides.
    // Plain create: CLEAR the flag so a later ordered-qty recreate doesn't leave
    // the PDF showing shipped qtys for an invoice that actually bills ordered.
    const newMeta: Record<string, any> = {
      ...tm,
      stripe_invoice_id: result.invoice_id,
      stripe_invoice_number: result.invoice_number,
      stripe_payment_link: result.hosted_invoice_url,
      stripe_total_cents: result.total_cents,
      stripe_invoice_status: result.status,
      stripe_customer_id: customer.id,
    };
    if (isVariance) {
      newMeta.stripe_variance_pushed_at = new Date().toISOString();
      newMeta.stripe_variance_total_cents = result.total_cents;
      if (billableQtys) newMeta.stripe_variance_billable_qtys = billableQtys;
    } else {
      delete newMeta.stripe_variance_pushed_at;
      delete newMeta.stripe_variance_total_cents;
      delete newMeta.stripe_variance_billable_qtys;
    }
    // Repoint to the new invoice BEFORE voiding the old one — see voidAfter above.
    await supabase.from("jobs").update({ type_meta: newMeta }).eq("id", job.id);

    // Retire the prior invoice now that the replacement exists and type_meta
    // points at it (variance flow only). Best-effort — a failure here just
    // leaves an extra voidable invoice in Stripe; OpsHub already points at the
    // replacement, and the pay page self-heals to the latest open invoice.
    if (voidAfter && voidAfter.id !== result.invoice_id) {
      try {
        if (voidAfter.status === "draft") await stripe.invoices.del(voidAfter.id);
        else await voidInvoice(stripe, voidAfter.id);
      } catch (e: any) {
        console.error("[stripe/invoice] failed to retire prior invoice", voidAfter.id, e?.message);
      }
    }

    await supabase.from("job_activity").insert({
      job_id: job.id, user_id: user.id, type: "auto",
      message: isVariance
        ? `Invoice revised with shipped qtys — #${result.invoice_number} · $${(result.total_cents / 100).toFixed(2)}`
        : `Invoice pushed to Stripe — #${result.invoice_number} · $${(result.total_cents / 100).toFixed(2)}`,
    });

    return NextResponse.json({
      invoiceId: result.invoice_id,
      invoiceNumber: result.invoice_number,
      hostedUrl: result.hosted_invoice_url,
      totalCents: result.total_cents,
      status: result.status,
      revised: isVariance || undefined,
    });
  } catch (e: any) {
    console.error("[stripe/invoice]", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
