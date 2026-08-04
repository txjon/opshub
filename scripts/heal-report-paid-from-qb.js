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
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_MINOR_VERSION = "73";

const [, , qbInvoiceId] = process.argv;
if (!qbInvoiceId) { console.error("Usage: node scripts/heal-report-paid-from-qb.js <qbInvoiceId>"); process.exit(1); }

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
  await supabase.from("qb_tokens").update({
    access_token: data.access_token, refresh_token: data.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", tokens.id);
  return { access: data.access_token, realm: tokens.realm_id };
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
