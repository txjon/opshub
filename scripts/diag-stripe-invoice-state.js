#!/usr/bin/env node
// Compare OpsHub's saved Stripe invoice ID for a job vs what Stripe
// actually says about that invoice. Used to chase ghost-invoice bugs
// where the pay page resolves a voided invoice even though OpsHub UI
// shows a freshly-created one.
//
// Usage:
//   node scripts/diag-stripe-invoice-state.js <job_number>
//
// e.g.:
//   node scripts/diag-stripe-invoice-state.js IHM-2605-001

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , jobNumber] = process.argv;
if (!jobNumber) {
  console.error("Usage: node scripts/diag-stripe-invoice-state.js <job_number>");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: job, error } = await sb
    .from("jobs")
    .select("id, job_number, title, portal_token, type_meta, companies:company_id(slug)")
    .eq("job_number", jobNumber)
    .maybeSingle();
  if (error) throw error;
  if (!job) { console.error(`No job found with job_number=${jobNumber}`); process.exit(1); }

  const tm = job.type_meta || {};
  const slug = job.companies?.slug || "hpd";
  console.log("=== OpsHub job ===");
  console.log("  id:                       ", job.id);
  console.log("  title:                    ", job.title);
  console.log("  portal_token:             ", job.portal_token);
  console.log("  tenant slug:              ", slug);
  console.log("  type_meta.stripe_invoice_id:        ", tm.stripe_invoice_id);
  console.log("  type_meta.stripe_invoice_number:    ", tm.stripe_invoice_number);
  console.log("  type_meta.stripe_invoice_status:    ", tm.stripe_invoice_status);
  console.log("  type_meta.stripe_payment_intent_id: ", tm.stripe_payment_intent_id);
  console.log("  type_meta.stripe_payment_link:      ", tm.stripe_payment_link);

  if (!tm.stripe_invoice_id) {
    console.log("\nNo stripe_invoice_id on this job — nothing to compare.");
    process.exit(0);
  }

  const Stripe = require("stripe").default || require("stripe");
  const keyEnv = `STRIPE_SECRET_KEY_${slug.toUpperCase()}`;
  const stripeKey = process.env[keyEnv];
  if (!stripeKey) {
    console.error(`\nMissing ${keyEnv} in .env.local — can't query Stripe.`);
    process.exit(1);
  }
  const stripe = new Stripe(stripeKey);

  console.log("\n=== Stripe says about that invoice ===");
  try {
    const inv = await stripe.invoices.retrieve(tm.stripe_invoice_id);
    console.log("  id:               ", inv.id);
    console.log("  number:           ", inv.number);
    console.log("  status:           ", inv.status);
    console.log("  amount_due (¢):   ", inv.amount_due);
    console.log("  amount_paid (¢):  ", inv.amount_paid);
    console.log("  hosted_invoice_url:", inv.hosted_invoice_url);
    console.log("  payment_intent:   ", inv.payment_intent);
    console.log("  collection_method:", inv.collection_method);
    console.log("  created:          ", new Date(inv.created * 1000).toISOString());
  } catch (e) {
    console.error("Stripe retrieve failed:", e.message);
  }

  // Also list every invoice for this customer so we can see if there's a
  // mismatch between what OpsHub thinks is current and what Stripe has.
  if (tm.stripe_customer_id) {
    console.log("\n=== Recent invoices for this Stripe customer ===");
    const list = await stripe.invoices.list({ customer: tm.stripe_customer_id, limit: 10 });
    for (const inv of list.data) {
      console.log(`  ${inv.number || "(draft)"}  status=${inv.status}  amount_due=$${(inv.amount_due / 100).toFixed(2)}  id=${inv.id}`);
    }
  }
})();
