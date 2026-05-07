import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getStripeClient } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/stripe/payment-intent/[token]
// Public endpoint backing the white-label pay page at
// /portal/{token}/pay. Resolves the job's portal token, looks up its
// Stripe invoice, and returns the PaymentIntent's client_secret so the
// pay page can mount Stripe's Payment Element directly. The client
// never lands on a stripe.com URL.
//
// Auth: portal token = bearer token. We look up jobs.portal_token; if
// the token doesn't match a row we return 404 indistinguishably.
//
// Tenant: derived from the job's company_id. The Stripe API key is
// per-tenant (different Stripe accounts), so we resolve the tenant
// slug from the company row and pass it to getStripeClient().

function admin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const sb = admin();
    const { data: job } = await sb
      .from("jobs")
      .select("id, title, job_number, type_meta, client_id, companies:company_id(slug), clients(name)")
      .eq("portal_token", params.token)
      .maybeSingle();
    if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const tm = ((job as any).type_meta || {}) as any;
    const stripeInvoiceId = tm.stripe_invoice_id as string | undefined;
    if (!stripeInvoiceId) {
      return NextResponse.json({ error: "No Stripe invoice has been pushed for this project yet." }, { status: 400 });
    }

    const slug = ((job as any).companies?.slug || "hpd") as string;
    const stripe = getStripeClient(slug);

    // Pull the invoice. If the saved ID points at a voided/uncollectible
    // invoice (common when the user voided + recreated, but Vercel's
    // serverless layer is reading a stale cached row from Supabase),
    // fall back to the customer's latest open/draft invoice. This makes
    // the pay link resilient to read-after-write lag and to old emails
    // that pre-date a recreate cycle.
    let invoice: any = await stripe.invoices.retrieve(stripeInvoiceId);
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      try {
        const list = await stripe.invoices.list({
          customer: typeof invoice.customer === "string"
            ? invoice.customer
            : (invoice.customer as any)?.id,
          status: "open",
          limit: 5,
        });
        const fresh = (list.data || [])
          .filter((i: any) => i.status === "open" && (i.amount_due || 0) > 0)
          .sort((a: any, b: any) => (b.created || 0) - (a.created || 0))[0];
        if (fresh) {
          invoice = fresh;
        }
      } catch (e) {
        // fall through — original invoice will get the error response below
      }
    }

    if (invoice.status === "paid") {
      return NextResponse.json({
        alreadyPaid: true,
        invoiceNumber: invoice.number,
        amountDueCents: 0,
      });
    }
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      return NextResponse.json({
        error: "This invoice is no longer payable. Contact your account manager.",
        debug: {
          opshub_stripe_invoice_id: stripeInvoiceId,
          opshub_stripe_invoice_number: tm.stripe_invoice_number || null,
          stripe_invoice_id: invoice.id,
          stripe_invoice_number: invoice.number,
          stripe_status: invoice.status,
          tenant: slug,
        },
      }, { status: 400 });
    }

    // Get or create the PaymentIntent. For collection_method=send_invoice
    // Stripe sometimes doesn't auto-attach a PI until the customer pays
    // via the hosted page — which we bypass entirely. Create one
    // ourselves the first time, then stash the PI ID on the invoice's
    // own metadata so subsequent /pay loads can find it without us
    // having to write back to OpsHub's type_meta. (Earlier we wrote
    // stripe_payment_intent_id to type_meta, but that read-modify-write
    // could clobber a freshly-updated stripe_invoice_id when Vercel's
    // serverless layer was reading from a stale Supabase replica —
    // re-committing the stale read silently downgraded -r4 → -r3.)
    let paymentIntent: any;
    const invoicePiId = (invoice as any).payment_intent as string | null;
    const stashedPiId = invoice.metadata?.tier3_pi as string | undefined;

    if (stashedPiId || invoicePiId) {
      try {
        paymentIntent = await stripe.paymentIntents.retrieve((stashedPiId || invoicePiId)!);
        if (paymentIntent.status === "canceled") paymentIntent = null;
      } catch {
        paymentIntent = null;
      }
    }

    if (!paymentIntent) {
      const customerId = typeof invoice.customer === "string"
        ? invoice.customer
        : (invoice.customer as any)?.id;
      paymentIntent = await stripe.paymentIntents.create({
        amount: invoice.amount_due,
        currency: invoice.currency,
        customer: customerId,
        description: `Invoice ${invoice.number || invoice.id} — ${(job as any).title || ""}`,
        metadata: {
          stripe_invoice_id: invoice.id!,
          opshub_job_id: (job as any).id,
        },
        automatic_payment_methods: { enabled: true },
        // ACH via Stripe Financial Connections — instant bank
        // verification (the client logs into their bank inline)
        // instead of the 3-5 day micro-deposit dance. Falls back
        // gracefully if the account/bank isn't supported.
        payment_method_options: {
          us_bank_account: {
            financial_connections: { permissions: ["payment_method"] },
            verification_method: "instant",
          },
        },
        // Save the verified bank account / card on the customer so the
        // next invoice's PaymentElement shows it as a one-click option
        // and the client doesn't have to re-verify their bank every
        // time. "on_session" = we'll charge it again with the customer
        // present (matches our flow — they always click Pay).
        setup_future_usage: "on_session",
      });
      // Stash the PI on the invoice metadata. Stripe is the source of
      // truth for invoice ↔ PI linkage now; OpsHub's DB is read-only
      // from this route. Subsequent reloads pull the same PI back.
      try {
        await stripe.invoices.update(invoice.id!, {
          metadata: { ...(invoice.metadata || {}), tier3_pi: paymentIntent.id },
        });
      } catch {
        // Non-fatal — worst case the next reload creates another PI
        // and Stripe auto-cancels the orphan after 24h.
      }
    }

    return NextResponse.json({
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env[`STRIPE_PUBLISHABLE_KEY_${slug.toUpperCase()}`] || process.env.STRIPE_PUBLISHABLE_KEY || "",
      amountDueCents: invoice.amount_due,
      currency: invoice.currency,
      invoiceNumber: invoice.number,
      jobNumber: (job as any).job_number,
      jobTitle: (job as any).title,
      clientName: (job as any).clients?.name || null,
      tenantSlug: slug,
    });
  } catch (e: any) {
    console.error("[stripe/payment-intent]", e);
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
