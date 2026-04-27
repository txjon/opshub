#!/usr/bin/env node
/**
 * Heal a QB invoice that has no BillEmail and no InvoiceLink.
 *
 * Symptom: /invoice/{id}/send returns 500 NullPointerException because
 * QB's send endpoint can't tolerate BillEmail being empty when the
 * customer's PreferredDeliveryMethod is "None" — even when sendTo is
 * passed explicitly. QB still reads BillEmail to record the send.
 *
 * Fix: PATCH the invoice to set BillEmail to a sentinel address
 * (hello@housepartydistro.com), then call /send to mint the customer-
 * facing InvoiceLink, then save it back to the OpsHub job.
 *
 * Usage: node scripts/heal-qb-invoice.js <qbInvoiceId>
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_MINOR_VERSION = "73";
const SENTINEL_EMAIL = "hello@housepartydistro.com";

const [, , qbInvoiceId] = process.argv;
if (!qbInvoiceId) { console.error("Usage: node scripts/heal-qb-invoice.js <qbInvoiceId>"); process.exit(1); }

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
  const sep = path.includes("?") ? "&" : "?";
  const url = `${QB_BASE_URL}/v3/company/${realm}${path}${sep}minorversion=${QB_MINOR_VERSION}`;
  const body = init.body ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body)) : undefined;
  const res = await fetch(url, {
    method: init.method || "GET",
    headers: { Authorization: `Bearer ${access}`, Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}), ...(init.headers || {}) },
    body,
  });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) throw new Error(`${path} ${res.status} (tid ${tid}): ${await res.text()}`);
  return res.json();
}

(async () => {
  const { access, realm } = await getAccessToken();
  console.log(`Realm: ${realm}\n`);

  // 1. Find the OpsHub job pointing at this invoice
  const { data: jobs, error: jErr } = await supabase
    .from("jobs")
    .select("id, job_number, title, type_meta")
    .filter("type_meta->>qb_invoice_id", "eq", String(qbInvoiceId));
  if (jErr) throw new Error(`Job lookup failed: ${jErr.message}`);
  const job = jobs?.[0];
  if (!job) {
    console.warn(`⚠ No OpsHub job linked to QB invoice ${qbInvoiceId}. Will still heal the QB side, but no link will be saved to OpsHub.`);
  } else {
    console.log(`OpsHub job: ${job.job_number} — "${job.title}" (id ${job.id})\n`);
  }

  // 2. Read invoice
  const inv = (await qb(access, realm, `/invoice/${qbInvoiceId}`)).Invoice;
  if (!inv) { console.error("Invoice not found in QB"); process.exit(1); }
  console.log(`QB Invoice #${inv.DocNumber} (id ${inv.Id})`);
  console.log(`  BillEmail before:  ${inv.BillEmail?.Address || "(empty)"}`);
  console.log(`  InvoiceLink before: ${inv.InvoiceLink || "(empty)"}\n`);

  // 3. PATCH BillEmail to sentinel if empty
  let workingInv = inv;
  if (!inv.BillEmail?.Address) {
    console.log(`Setting BillEmail to ${SENTINEL_EMAIL}…`);
    const patchBody = {
      Id: inv.Id,
      SyncToken: inv.SyncToken,
      sparse: true,
      BillEmail: { Address: SENTINEL_EMAIL },
    };
    const patched = await qb(access, realm, "/invoice", { method: "POST", body: patchBody });
    workingInv = patched.Invoice;
    console.log(`  ✓ BillEmail now: ${workingInv.BillEmail?.Address}\n`);
  } else {
    console.log("BillEmail already set, skipping PATCH.\n");
  }

  // 4. Call /send to mint InvoiceLink. Send to sentinel — same address as
  //    BillEmail — keeps QB's confirmation emails out of the customer's
  //    inbox. OpsHub sends the customer-facing email via Resend.
  console.log(`Calling /send to mint InvoiceLink…`);
  const sent = await qb(access, realm, `/invoice/${qbInvoiceId}/send?sendTo=${encodeURIComponent(SENTINEL_EMAIL)}`, { method: "POST" });
  let link = sent?.Invoice?.InvoiceLink || "";
  for (let i = 0; i < 4 && !link; i++) {
    await new Promise(r => setTimeout(r, 400 * (i + 1)));
    const retry = (await qb(access, realm, `/invoice/${qbInvoiceId}`)).Invoice;
    link = retry?.InvoiceLink || "";
  }
  if (!link) { console.error("✕ QB returned no InvoiceLink after /send"); process.exit(1); }
  console.log(`  ✓ InvoiceLink: ${link}\n`);

  // 5. Save to OpsHub job
  if (job) {
    await supabase.from("jobs").update({
      type_meta: { ...(job.type_meta || {}), qb_payment_link: link },
    }).eq("id", job.id);
    await supabase.from("job_activity").insert({
      job_id: job.id, type: "auto",
      message: `QB payment link healed (BillEmail set, link minted)`,
    });
    console.log(`✓ Saved to OpsHub job ${job.job_number}.`);
  }

  console.log("\nDone.");
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
