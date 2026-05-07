#!/usr/bin/env node
// Resync OpsHub's type_meta.stripe_invoice_* fields with the source of
// truth in Stripe. Useful when a read-modify-write race rolled OpsHub
// back to a stale invoice (we hit one when Vercel's Supabase reads
// were ~7 min behind the primary).
//
// Behavior:
//   - Look up the job by job_number
//   - Pull the Stripe customer ID off type_meta
//   - List recent invoices for that customer
//   - Pick the most recent non-void invoice (open / paid / draft)
//   - Update type_meta to point at that invoice + its current status
//
// Usage:
//   node scripts/resync-stripe-invoice.js <job_number>
//   node scripts/resync-stripe-invoice.js IHM-2605-001

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , jobNumber] = process.argv;
if (!jobNumber) {
  console.error("Usage: node scripts/resync-stripe-invoice.js <job_number>");
  process.exit(1);
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const { data: job } = await sb
    .from("jobs")
    .select("id, job_number, type_meta, companies:company_id(slug)")
    .eq("job_number", jobNumber)
    .maybeSingle();
  if (!job) { console.error(`No job with job_number=${jobNumber}`); process.exit(1); }

  const tm = job.type_meta || {};
  const slug = (job.companies?.slug || "hpd");
  const customerId = tm.stripe_customer_id;
  if (!customerId) { console.error("No stripe_customer_id on this job"); process.exit(1); }

  const Stripe = require("stripe").default || require("stripe");
  const stripeKey = process.env[`STRIPE_SECRET_KEY_${slug.toUpperCase()}`];
  if (!stripeKey) {
    console.error(`Missing STRIPE_SECRET_KEY_${slug.toUpperCase()} in .env.local`);
    process.exit(1);
  }
  const stripe = new Stripe(stripeKey);

  const list = await stripe.invoices.list({ customer: customerId, limit: 20 });
  const invoices = list.data.sort((a, b) => (b.created || 0) - (a.created || 0));

  console.log("=== Recent invoices for customer ===");
  for (const inv of invoices.slice(0, 8)) {
    const marker = inv.id === tm.stripe_invoice_id ? " ← OpsHub points here" : "";
    console.log(`  ${inv.number || "(draft)"}  status=${inv.status}  amount_due=$${(inv.amount_due/100).toFixed(2)}  id=${inv.id}${marker}`);
  }

  // Pick: latest open > latest paid > latest draft. Skip void/uncollectible.
  const pick = invoices.find(i => i.status === "open")
    || invoices.find(i => i.status === "paid")
    || invoices.find(i => i.status === "draft");
  if (!pick) { console.log("\nNo non-void invoice found — nothing to resync."); process.exit(0); }

  console.log(`\n=== Resyncing OpsHub to ${pick.number || pick.id} (status=${pick.status}) ===`);
  const newMeta = {
    ...tm,
    stripe_invoice_id: pick.id,
    stripe_invoice_number: pick.number || tm.stripe_invoice_number,
    stripe_invoice_status: pick.status,
    stripe_total_cents: pick.total,
    stripe_payment_link: pick.hosted_invoice_url || tm.stripe_payment_link,
  };
  const { error } = await sb.from("jobs").update({ type_meta: newMeta }).eq("id", job.id);
  if (error) { console.error("Update failed:", error.message); process.exit(1); }
  console.log("Done. Refresh OpsHub.");
})();
