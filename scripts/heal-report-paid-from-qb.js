#!/usr/bin/env node
/**
 * Heal a fulfillment report's paid_amount from QB truth.
 *
 * Symptom (invoice 4419, Aug 4 2026): a client pays in waves — QB caps a
 * single payment at $100K, so $123,216.81 arrived as $100,000 + $23,216.81,
 * eleven seconds apart. The webhook's report path OVERWROTE paid_amount with
 * each event's own amount (last write wins), leaving Paid $23,216.81 /
 * Balance $100,000 on a fully paid invoice.
 *
 * Fix: read the invoice from QB (the authority) and set
 * paid_amount = TotalAmt - Balance. Read-only against QB; one field written
 * in OpsHub, and only when QB disagrees with what's stored.
 *
 * Usage: node scripts/heal-report-paid-from-qb.js <qbInvoiceId>
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_MINOR_VERSION = "73";

const [, , qbInvoiceId] = process.argv;
if (!qbInvoiceId) { console.error("Usage: node scripts/heal-report-paid-from-qb.js <qbInvoiceId>"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getAccessToken() {
  const { data: tokens } = await supabase.from("qb_tokens").select("*").limit(1).single();
  if (!tokens) throw new Error("No QB tokens");
  const expiresAt = new Date(tokens.expires_at).getTime();
  if (Date.now() < expiresAt - 5 * 60 * 1000) return { access: tokens.access_token, realm: tokens.realm_id };
  // Nov 4 2026: scripts never renew the QB token themselves. A renewal here
  // bypassed lib/quickbooks' lease + log and could overlap the server's, which
  // kills the connection. Any QB action in OpsHub renews it; then re-run.
  throw new Error("QuickBooks token is due for renewal. Do any QuickBooks action in OpsHub (or wait for the hourly sync), then re-run this script.");
}

(async () => {
  const { access, realm } = await getAccessToken();
  const res = await fetch(`${QB_BASE_URL}/v3/company/${realm}/invoice/${qbInvoiceId}?minorversion=${QB_MINOR_VERSION}`, {
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QB invoice fetch ${res.status}: ${await res.text()}`);
  const inv = (await res.json()).Invoice;
  const total = Number(inv.TotalAmt) || 0;
  const balance = Number(inv.Balance) || 0;
  const paid = Math.round((total - balance) * 100) / 100;
  console.log(`QB invoice ${inv.DocNumber} (${qbInvoiceId}): TotalAmt $${total} · Balance $${balance} → paid $${paid}`);

  const { data: report } = await supabase.from("shipstation_reports")
    .select("id, period_label, qb_invoice_number, paid_amount, paid_at, clients(name)")
    .eq("qb_invoice_id", String(qbInvoiceId)).single();
  if (!report) throw new Error("No shipstation_report matches that qb_invoice_id");
  const stored = Number(report.paid_amount) || 0;
  console.log(`OpsHub report: ${report.clients?.name} · ${report.period_label} · stored paid $${stored}`);

  if (Math.abs(stored - paid) < 0.01) { console.log("Already in agreement — nothing to do."); return; }
  const { error } = await supabase.from("shipstation_reports").update({ paid_amount: paid }).eq("id", report.id);
  if (error) throw new Error(error.message);
  console.log(`✓ Healed: paid_amount $${stored} → $${paid} (QB-verified).`);
})().catch((e) => { console.error(e.message); process.exit(1); });
