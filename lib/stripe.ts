import Stripe from "stripe";

// Per-company Stripe credentials. Each tenant has its own Stripe
// account; the secret key + webhook secret are read from env vars
// keyed by the company slug. Add a new tenant by setting:
//   STRIPE_SECRET_KEY_<SLUG_UPPER>
//   STRIPE_WEBHOOK_SECRET_<SLUG_UPPER>
//
// HPD doesn't use Stripe today (still on QuickBooks), so only IHM has
// keys configured. Calling getStripeClient("hpd") will throw — that's
// intentional: any code path that hits Stripe should already know
// it's working in a Stripe-backed company.

export class StripeNotConfiguredError extends Error {
  constructor(slug: string) {
    super(`Stripe not configured for company "${slug}" — set STRIPE_SECRET_KEY_${slug.toUpperCase()} in env`);
    this.name = "StripeNotConfiguredError";
  }
}

export function getStripeClient(companySlug: string): Stripe {
  const envKey = `STRIPE_SECRET_KEY_${companySlug.toUpperCase()}`;
  const secret = process.env[envKey];
  if (!secret) throw new StripeNotConfiguredError(companySlug);
  // Let the SDK use its built-in default API version — pinning here
  // ties the migration to a specific SDK release; not worth the
  // coupling for a fresh integration.
  return new Stripe(secret);
}

export function getStripeWebhookSecret(companySlug: string): string {
  const envKey = `STRIPE_WEBHOOK_SECRET_${companySlug.toUpperCase()}`;
  const secret = process.env[envKey];
  if (!secret) throw new Error(`Missing ${envKey} env var`);
  return secret;
}

// ─── Customer ───────────────────────────────────────────────────────
// Stripe customers are looked up by email when present; that's the
// strongest match in practice for ecomm-style invoicing (one client =
// one billing email). Falls back to creating a new customer if no
// match is found. Returns the Stripe customer object.

export async function findOrCreateCustomer(
  stripe: Stripe,
  params: { name: string; email?: string | null; externalId?: string | null }
): Promise<Stripe.Customer> {
  const { name, email, externalId } = params;

  if (email) {
    // Stripe API supports a `query` form: email:'...' for exact match.
    // If multiple results, take the most recently created (Stripe
    // returns newest first by default).
    const search = await stripe.customers.search({
      query: `email:'${email.replace(/'/g, "\\'")}'`,
      limit: 1,
    });
    if (search.data[0]) return search.data[0];
  }

  const created = await stripe.customers.create({
    name,
    email: email || undefined,
    metadata: externalId ? { opshub_id: externalId } : undefined,
  });
  return created;
}

// ─── Invoice ────────────────────────────────────────────────────────
// Stripe's flow: create invoice → add invoice items → finalize → send.
// Finalize generates the invoice number; send returns the
// hosted_invoice_url (which is the "Pay Online" link clients click).

export type StripeLineItem = {
  description: string;
  quantity: number;
  unit_amount_cents: number; // Stripe wants smallest currency unit
};

export async function createAndSendInvoice(
  stripe: Stripe,
  params: {
    customerId: string;
    lineItems: StripeLineItem[];
    /** ISO date or yyyy-mm-dd. If null, invoice is due immediately. */
    dueDate?: string | null;
    /** Free-form note shown on the invoice */
    description?: string | null;
    /** Restrict payment methods. Default = card + ACH. */
    allowCard?: boolean;
    allowAch?: boolean;
    /** Optional Stripe Tax — defaults to off. Stripe Tax requires the
     *  account to have it enabled and the customer's tax address set. */
    autoTax?: boolean;
    /** Override Stripe's auto-generated invoice number with a custom
     *  string (e.g. job_number "IHM-2605-001"). Requires the Stripe
     *  account to have Manual Invoice Numbering enabled (Settings →
     *  Billing → Invoices). On collision (re-push after voiding the
     *  prior invoice in Stripe Dashboard), we suffix `-r2`, `-r3`, etc.
     *  When omitted, Stripe assigns its own sequential number. */
    customNumber?: string | null;
  }
): Promise<{
  invoice_id: string;
  invoice_number: string;
  hosted_invoice_url: string;
  total_cents: number;
  status: string;
}> {
  const { customerId, lineItems } = params;

  // Default payment methods — credit card + ACH debit. Stripe wants an
  // explicit list to scope what payment_method types appear on the
  // hosted invoice page. Empty array = no payment methods → bad UX.
  const paymentMethods: Stripe.InvoiceCreateParams.PaymentSettings.PaymentMethodType[] = [];
  if (params.allowCard !== false) paymentMethods.push("card");
  if (params.allowAch !== false) paymentMethods.push("us_bank_account");

  // Step 1: create the invoice in draft state
  const draft = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: params.dueDate
      ? Math.max(0, Math.ceil((new Date(params.dueDate).getTime() - Date.now()) / 86400000))
      : 30,
    description: params.description || undefined,
    auto_advance: false, // we drive finalize/send explicitly
    automatic_tax: params.autoTax ? { enabled: true } : undefined,
    payment_settings: { payment_method_types: paymentMethods },
  });

  // Step 1a (optional): apply a custom invoice number to the draft.
  // Stripe assigns numbers at finalize-time by default; updating
  // `number` on a draft requires Manual Invoice Numbering. On
  // collision we suffix `-r2..r5` then surface the original error.
  if (params.customNumber) {
    let lastErr: any;
    for (let attempt = 1; attempt <= 5; attempt++) {
      const candidate = attempt === 1 ? params.customNumber : `${params.customNumber}-r${attempt}`;
      try {
        await stripe.invoices.update(draft.id!, { number: candidate });
        lastErr = null;
        break;
      } catch (err: any) {
        const msg = String(err?.message || err?.raw?.message || "").toLowerCase();
        const looksLikeCollision = msg.includes("number") && /(taken|exists|duplicate|already|use)/.test(msg);
        if (!looksLikeCollision) throw err;
        lastErr = err;
      }
    }
    if (lastErr) throw lastErr;
  }

  // Step 2: add line items, attached to the draft. Stripe's
  // invoiceItems.create takes a total `amount` (smallest currency unit)
  // — not unit_amount × quantity. It also doesn't accept price_data
  // with product_data the way Checkout does (hence the original
  // "unknown parameter: price_data[product_data]" error). Pre-multiply
  // here and put qty in the description so the invoice line stays
  // legible without managing long-lived Stripe Products.
  for (const item of lineItems) {
    const desc = item.quantity > 1
      ? `${item.description} (${item.quantity} × $${(item.unit_amount_cents / 100).toFixed(2)})`
      : item.description;
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: draft.id,
      currency: "usd",
      description: desc,
      amount: item.quantity * item.unit_amount_cents,
    });
  }

  // Step 3: finalize → generates the invoice number + makes it sendable
  const finalized = await stripe.invoices.finalizeInvoice(draft.id!);

  // Step 4: send → emails the client + activates the hosted_invoice_url
  const sent = await stripe.invoices.sendInvoice(finalized.id!);

  return {
    invoice_id: sent.id!,
    invoice_number: sent.number || sent.id!,
    hosted_invoice_url: sent.hosted_invoice_url || "",
    total_cents: sent.total,
    status: sent.status || "draft",
  };
}

export async function getInvoice(stripe: Stripe, invoiceId: string): Promise<Stripe.Invoice> {
  return await stripe.invoices.retrieve(invoiceId);
}

// ─── Webhook signature verification ─────────────────────────────────

export function verifyWebhookSignature(
  payload: string | Buffer,
  signature: string,
  companySlug: string
): Stripe.Event {
  const stripe = getStripeClient(companySlug);
  const secret = getStripeWebhookSecret(companySlug);
  return stripe.webhooks.constructEvent(payload, signature, secret);
}
