#!/usr/bin/env node
/**
 * Audit (+ optionally fix) jobs with broken QB payment links.
 *
 * The broken pattern is `app.qbo.intuit.com/app/invoices/pay?txnId=…`,
 * which is QB's logged-in admin URL and 404s for customers. The real
 * link lives in the invoice's InvoiceLink field (connect.intuit.com/portal/…).
 *
 * Usage:
 *   node scripts/audit-qb-payment-links.js           # list only (dry run)
 *   node scripts/audit-qb-payment-links.js --fix     # regenerate links in place
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

const FIX = process.argv.includes("--fix");
const BROKEN_PREFIX = "https://app.qbo.intuit.com/app/invoices/pay";

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
  if (!res.ok) throw new Error(`${path} ${res.status}: ${await res.text()}`);
  return res.json();
}

async function regenerateFor(access, realm, job) {
  const invoiceId = job.type_meta?.qb_invoice_id;
  if (!invoiceId) return { ok: false, reason: "no qb_invoice_id" };

  const inv = (await qb(access, realm, `/invoice/${invoiceId}`)).Invoice;
  let link = inv?.InvoiceLink || "";

  if (!link) {
    const { data: contacts } = await supabase.from("job_contacts").select("role_on_job, contacts(email)").eq("job_id", job.id);
    const byRole = r => contacts?.find(c => c.role_on_job === r)?.contacts?.email;
    const anyEmail = contacts?.map(c => c.contacts?.email).find(Boolean);
    const email = inv?.BillEmail?.Address || byRole("billing") || byRole("primary") || anyEmail;
    if (!email) return { ok: false, reason: "no email to send to" };

    const sent = await qb(access, realm, `/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(email)}`, { method: "POST" });
    link = sent?.Invoice?.InvoiceLink || "";
    if (!link) {
      const retry = (await qb(access, realm, `/invoice/${invoiceId}`)).Invoice;
      link = retry?.InvoiceLink || "";
    }
    if (!link) return { ok: false, reason: "QB did not return InvoiceLink after send" };
  }

  await supabase.from("jobs").update({ type_meta: { ...(job.type_meta || {}), qb_payment_link: link } }).eq("id", job.id);
  return { ok: true, link };
}

(async () => {
  const { data: jobs } = await supabase.from("jobs").select("id, job_number, title, type_meta").filter("type_meta->>qb_payment_link", "like", `${BROKEN_PREFIX}%`);
  if (!jobs?.length) { console.log("No jobs with broken payment links. Clean."); return; }

  console.log(`Found ${jobs.length} job(s) with broken QB payment link:\n`);
  for (const j of jobs) console.log(`  ${j.job_number}  "${j.title}"  → ${j.type_meta?.qb_payment_link}`);

  if (!FIX) { console.log("\n(dry run) Re-run with --fix to regenerate."); return; }

  console.log("\nRegenerating…\n");
  const { access, realm } = await getAccessToken();
  for (const j of jobs) {
    try {
      const r = await regenerateFor(access, realm, j);
      if (r.ok) console.log(`  ✓ ${j.job_number}  →  ${r.link}`);
      else console.log(`  ✕ ${j.job_number}  (${r.reason})`);
    } catch (e) {
      console.log(`  ✕ ${j.job_number}  (${e.message})`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
