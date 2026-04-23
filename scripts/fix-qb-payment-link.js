#!/usr/bin/env node
/**
 * Regenerate a working QB payment link for an existing invoice.
 *
 * If the invoice already has an InvoiceLink, use it.
 * Otherwise, call QB's /invoice/{id}/send endpoint with the primary
 * contact email — that triggers QB to generate the public payment
 * link, which we then save to type_meta.qb_payment_link.
 *
 * Usage: node scripts/fix-qb-payment-link.js <jobId>
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const [, , jobId] = process.argv;
if (!jobId) { console.error("Usage: node scripts/fix-qb-payment-link.js <jobId>"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getAccessToken() {
  const { data: tokens } = await supabase.from("qb_tokens").select("*").limit(1).single();
  if (!tokens) throw new Error("No QB tokens");
  const expiresAt = new Date(tokens.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return { access: tokens.access_token, realm: tokens.realm_id };
  const auth = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) throw new Error(`Refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const newExpires = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from("qb_tokens").update({
    access_token: data.access_token, refresh_token: data.refresh_token, expires_at: newExpires, updated_at: new Date().toISOString(),
  }).eq("id", tokens.id);
  return { access: data.access_token, realm: tokens.realm_id };
}

async function qb(access, realm, path, init = {}) {
  const res = await fetch(`${QB_BASE_URL}/v3/company/${realm}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`QB ${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function main() {
  const { access, realm } = await getAccessToken();

  const { data: job } = await supabase.from("jobs").select("id, job_number, title, type_meta").eq("id", jobId).single();
  if (!job) { console.error("Job not found"); process.exit(1); }
  const invoiceId = job.type_meta?.qb_invoice_id;
  if (!invoiceId) { console.error("Job has no qb_invoice_id"); process.exit(1); }
  console.log(`→ Job ${job.job_number} — invoice id ${invoiceId}`);

  // Read invoice
  const first = await qb(access, realm, `/invoice/${invoiceId}`);
  const inv = first.Invoice;
  console.log(`  DocNumber: ${inv.DocNumber}`);
  console.log(`  InvoiceLink (before): ${inv.InvoiceLink || "(empty)"}`);
  console.log(`  BillEmail: ${inv.BillEmail?.Address || "(none on invoice)"}`);

  let paymentLink = inv.InvoiceLink || "";

  if (!paymentLink) {
    // Resolve primary contact email from OpsHub
    const { data: contacts } = await supabase.from("job_contacts").select("role_on_job, contacts(email)").eq("job_id", jobId);
    const byRole = r => contacts?.find(c => c.role_on_job === r)?.contacts?.email;
    const anyEmail = contacts?.map(c => c.contacts?.email).find(Boolean);
    const email = inv.BillEmail?.Address || byRole("billing") || byRole("primary") || anyEmail;
    if (!email) { console.error("  No email to send to — aborting"); process.exit(1); }
    console.log(`  Sending invoice via QB to ${email} to generate payment link…`);

    const sent = await qb(access, realm, `/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(email)}`, { method: "POST" });
    paymentLink = sent?.Invoice?.InvoiceLink || "";
    if (!paymentLink) {
      // Re-read once more — sometimes the link appears on next read
      const second = await qb(access, realm, `/invoice/${invoiceId}`);
      paymentLink = second.Invoice.InvoiceLink || "";
    }
  }

  if (!paymentLink) { console.error("  Still no InvoiceLink — aborting"); process.exit(1); }
  console.log(`  InvoiceLink (after):  ${paymentLink}`);

  await supabase.from("jobs").update({
    type_meta: { ...(job.type_meta || {}), qb_payment_link: paymentLink },
  }).eq("id", jobId);

  console.log("\n✓ Payment link updated in OpsHub.");
}

main().catch(e => { console.error(e); process.exit(1); });
