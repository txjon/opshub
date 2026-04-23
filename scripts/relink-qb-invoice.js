#!/usr/bin/env node
/**
 * Relink a job to an existing QuickBooks invoice.
 *
 * Use when a job's qb_invoice_id got lost and a stray duplicate invoice
 * was created. Repoints type_meta to the original QB invoice so the
 * next "Push to QB" from OpsHub updates the original instead of making
 * a new one.
 *
 * Usage:
 *   node scripts/relink-qb-invoice.js <jobId> <qbInvoiceId>
 *
 * Example:
 *   node scripts/relink-qb-invoice.js a1b2c3...  31566
 *
 * Before: ensure the duplicate (new) invoice in QB is voided/deleted
 * so you don't end up charging the client twice.
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const [, , jobId, qbInvoiceId] = process.argv;
if (!jobId || !qbInvoiceId) {
  console.error("Usage: node scripts/relink-qb-invoice.js <jobId> <qbInvoiceId>");
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getAccessToken() {
  const { data: tokens } = await supabase.from("qb_tokens").select("*").limit(1).single();
  if (!tokens) throw new Error("No QB tokens in DB — reconnect QuickBooks first");

  const expiresAt = new Date(tokens.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return { access: tokens.access_token, realm: tokens.realm_id };

  // Refresh
  const auth = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: tokens.refresh_token }),
  });
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const newExpires = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabase.from("qb_tokens").update({
    access_token: data.access_token, refresh_token: data.refresh_token, expires_at: newExpires, updated_at: new Date().toISOString(),
  }).eq("id", tokens.id);
  return { access: data.access_token, realm: tokens.realm_id };
}

async function main() {
  const { access, realm } = await getAccessToken();
  console.log(`→ QB realm: ${realm}`);

  // 1. Fetch the invoice from QB
  const url = `${QB_BASE_URL}/v3/company/${realm}/invoice/${qbInvoiceId}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } });
  if (!res.ok) {
    console.error(`QB fetch failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  const { Invoice: inv } = await res.json();
  if (!inv) { console.error("No Invoice in QB response"); process.exit(1); }

  const invoiceNumber = inv.DocNumber || String(inv.Id);
  const taxAmount = inv.TxnTaxDetail?.TotalTax || 0;
  const totalWithTax = inv.TotalAmt || 0;
  const paymentLink = inv.InvoiceLink || `https://app.qbo.intuit.com/app/invoices/pay?txnId=${inv.Id}&companyId=${realm}`;

  console.log(`→ QB Invoice #${invoiceNumber} (Id ${inv.Id}) — $${totalWithTax.toFixed(2)} total, $${taxAmount.toFixed(2)} tax`);

  // 2. Load current job type_meta
  const { data: job, error: jobErr } = await supabase.from("jobs").select("id, title, job_number, type_meta").eq("id", jobId).single();
  if (jobErr || !job) { console.error("Job not found:", jobErr?.message); process.exit(1); }

  const prev = job.type_meta || {};
  console.log(`→ Job ${job.job_number} — "${job.title}"`);
  console.log(`  Before: qb_invoice_id=${prev.qb_invoice_id || "(none)"}, qb_invoice_number=${prev.qb_invoice_number || "(none)"}`);

  // 3. Write the original invoice's fields back into type_meta
  const newMeta = {
    ...prev,
    qb_invoice_id: String(inv.Id),
    qb_invoice_number: invoiceNumber,
    qb_payment_link: paymentLink,
    qb_tax_amount: taxAmount,
    qb_total_with_tax: totalWithTax,
    qb_relinked_at: new Date().toISOString(),
  };

  const { error: upErr } = await supabase.from("jobs").update({ type_meta: newMeta }).eq("id", jobId);
  if (upErr) { console.error("Update failed:", upErr.message); process.exit(1); }
  console.log(`  After:  qb_invoice_id=${newMeta.qb_invoice_id}, qb_invoice_number=${newMeta.qb_invoice_number}`);

  // 4. Log to job activity
  await supabase.from("job_activity").insert({
    job_id: jobId, type: "auto",
    message: `Relinked to QB Invoice #${invoiceNumber} (id ${inv.Id}) — was pointing at ${prev.qb_invoice_number || "(none)"}`,
  });

  console.log("\n✓ Done. The next 'Push to QuickBooks' from OpsHub will update invoice #" + invoiceNumber + ".");
  console.log("  Reminder: void/delete the orphan duplicate invoice in QB if you haven't already.");
}

main().catch(e => { console.error(e); process.exit(1); });
