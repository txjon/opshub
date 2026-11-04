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
  // Nov 4 2026: scripts never renew the QB token themselves. A renewal here
  // bypassed lib/quickbooks' lease + log and could overlap the server's, which
  // kills the connection. Any QB action in OpsHub renews it; then re-run.
  throw new Error("QuickBooks token is due for renewal. Do any QuickBooks action in OpsHub (or wait for the hourly sync), then re-run this script.");
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
  const { data: job, error: jobErr } = await supabase.from("jobs").select("id, title, job_number, qb_invoice_number, qb_invoice_id, type_meta").eq("id", jobId).single();
  if (jobErr || !job) { console.error("Job not found:", jobErr?.message); process.exit(1); }

  const prev = job.type_meta || {};
  console.log(`→ Job ${job.job_number} — "${job.title}"`);
  console.log(`  Before: qb_invoice_id=${job.qb_invoice_id || "(none)"}, qb_invoice_number=${job.qb_invoice_number || "(none)"}`);

  // 3. Identity → columns (mig 182); attributes → type_meta via atomic merge (mig 178)
  const { error: upErr } = await supabase.from("jobs").update({ qb_invoice_id: String(inv.Id), qb_invoice_number: invoiceNumber }).eq("id", jobId);
  if (upErr) { console.error("Update failed:", upErr.message); process.exit(1); }
  const { error: mErr } = await supabase.rpc("patch_job_type_meta", { p_job_id: jobId, p_patch: { qb_payment_link: paymentLink, qb_tax_amount: taxAmount, qb_total_with_tax: totalWithTax, qb_relinked_at: new Date().toISOString() } });
  if (mErr) { console.error("Attribute merge failed:", mErr.message); process.exit(1); }
  console.log(`  After:  qb_invoice_id=${String(inv.Id)}, qb_invoice_number=${invoiceNumber}`);

  // 4. Log to job activity
  await supabase.from("job_activity").insert({
    job_id: jobId, type: "auto",
    message: `Relinked to QB Invoice #${invoiceNumber} (id ${inv.Id}) — was pointing at ${job.qb_invoice_number || "(none)"}`,
  });

  console.log("\n✓ Done. The next 'Push to QuickBooks' from OpsHub will update invoice #" + invoiceNumber + ".");
  console.log("  Reminder: void/delete the orphan duplicate invoice in QB if you haven't already.");
}

main().catch(e => { console.error(e); process.exit(1); });
