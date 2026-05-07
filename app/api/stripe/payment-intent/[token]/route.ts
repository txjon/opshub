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

    // Pull the invoice + its payment_intent. PaymentIntent is created at
    // finalize time; we need its client_secret for the Payment Element.
    const invoice = await stripe.invoices.retrieve(stripeInvoiceId);
    if (invoice.status === "paid") {
      return NextResponse.json({
        alreadyPaid: true,
        invoiceNumber: invoice.number,
        amountDueCents: 0,
      });
    }
    if (invoice.status === "void" || invoice.status === "uncollectible") {
      // Diagnostic surface — when this fires we want to know which
      // invoice ID the route resolved + which OpsHub-side number it
      // matched, so we can chase ghost-invoice cases (saved ID points
      // at a stale invoice).
      return NextResponse.json({
        error: "This invoice is no longer payable. Contact your account manager.",
        debug: {
          opshub_stripe_invoice_id: stripeInvoiceId,
          opshub_stripe_invoice_number: tm.stripe_invoice_number || null,
          stripe_invoice_id: invoice.id,
          stripe_invoice_number: invoice.number,
          stripe_status: invoice.status,
          tenant: slug,
          // Probe what Supabase URL this serverless function is actually
          // talking to — chasing a case where local script + prod route
          // return different rows for the same portal_token.
          env_supabase_host: (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/^https?:\/\//, "").split(".")[0],
          tm_diag_sentinel: tm._diag_sentinel || null,
          tm_invoice_sent_at: tm.invoice_sent_at || null,
        },
      }, { status: 400 });
    }

    // Get or create the PaymentIntent. For collection_method=send_invoice
    // Stripe sometimes doesn't auto-attach a PI until the customer pays
    // via the hosted page — which we bypass entirely. Create one
    // ourselves the first time, store the ID in OpsHub's type_meta to
    // dedupe future loads, and let the webhook mark the invoice paid
    // when payment_intent.succeeded fires (matched via metadata).
    let paymentIntent: any;
    const cachedPiId = tm.stripe_payment_intent_id as string | undefined;
    const invoicePiId = (invoice as any).payment_intent as string | null;

    if (cachedPiId || invoicePiId) {
      try {
        paymentIntent = await stripe.paymentIntents.retrieve((cachedPiId || invoicePiId)!);
        // If a cached PI is no longer valid (canceled etc.), drop and recreate.
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
        description: `Invoice ${invoice.number || stripeInvoiceId} — ${(job as any).title || ""}`,
        metadata: {
          stripe_invoice_id: stripeInvoiceId,
          opshub_job_id: (job as any).id,
        },
        automatic_payment_methods: { enabled: true },
      });
      // Persist the PI ID so subsequent /pay loads return the same
      // client_secret (avoids creating ghost PIs on every refresh).
      await sb
        .from("jobs")
        .update({ type_meta: { ...tm, stripe_payment_intent_id: paymentIntent.id } })
        .eq("id", (job as any).id);
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
