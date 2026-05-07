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
      return NextResponse.json({ error: "This invoice is no longer payable. Contact your account manager." }, { status: 400 });
    }

    const paymentIntentId = (invoice as any).payment_intent as string | null;
    if (!paymentIntentId) {
      return NextResponse.json({ error: "Invoice has no payment intent yet — try again in a moment." }, { status: 400 });
    }
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);

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
