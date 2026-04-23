#!/usr/bin/env node
/**
 * Clear BillEmail from every QB invoice tied to an OpsHub job.
 *
 * With no invoice-level email, QB has nowhere to send payment-received
 * confirmation receipts, so clients stop getting QB-side emails. The
 * customer record in QB keeps its email (so QB still knows who the
 * customer is — only invoice-level email is wiped).
 *
 * Usage:
 *   node scripts/scrub-qb-bill-emails.js          # dry run
 *   node scripts/scrub-qb-bill-emails.js --fix    # actually clear
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const FIX = process.argv.includes("--fix");
const DELAY_MS = 1000; // 1s between invoices — gentle on QB rate limits

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sleep = ms => new Promise(r => setTimeout(r, ms));

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

(async () => {
  // Collect all jobs that point at a QB invoice
  const { data: jobs } = await supabase
    .from("jobs")
    .select("id, job_number, title, type_meta")
    .not("type_meta->>qb_invoice_id", "is", null);

  const candidates = (jobs || []).filter(j => j.type_meta?.qb_invoice_id).sort((a, b) => (a.job_number || "").localeCompare(b.job_number || ""));
  if (!candidates.length) { console.log("No jobs with qb_invoice_id. Nothing to do."); return; }

  console.log(`Found ${candidates.length} jobs with QB invoices.\n`);
  console.log(FIX ? "Running with --fix (real changes).\n" : "Dry run. Use --fix to apply.\n");

  const { access, realm } = await getAccessToken();

  let withEmail = 0, cleared = 0, already = 0, errors = 0;

  for (const j of candidates) {
    const invId = j.type_meta.qb_invoice_id;
    try {
      const fetched = await qb(access, realm, `/invoice/${invId}`);
      const inv = fetched.Invoice;
      if (!inv) { console.log(`  ✕ ${j.job_number}  invoice ${invId} not in QB`); errors++; continue; }

      const current = inv.BillEmail?.Address || "";
      if (!current) {
        already++;
        console.log(`  · ${j.job_number}  #${inv.DocNumber}  (already empty)`);
        continue;
      }

      withEmail++;
      console.log(`  ${FIX ? "→" : "?"} ${j.job_number}  #${inv.DocNumber}  BillEmail=${current}${FIX ? " → (clearing)" : ""}`);

      if (FIX) {
        const body = {
          Id: invId,
          SyncToken: inv.SyncToken,
          sparse: true,
          BillEmail: { Address: "" },
        };
        await qb(access, realm, "/invoice", { method: "POST", body: JSON.stringify(body) });

        // Verify
        const check = await qb(access, realm, `/invoice/${invId}`);
        const after = check.Invoice?.BillEmail?.Address || "";
        if (!after) {
          cleared++;
          console.log(`    ✓ cleared`);
        } else {
          errors++;
          console.log(`    ✕ still has BillEmail=${after} after update`);
        }
      }

      await sleep(DELAY_MS);
    } catch (e) {
      errors++;
      console.log(`  ✕ ${j.job_number}  ${e.message}`);
      await sleep(DELAY_MS);
    }
  }

  console.log(`\n${FIX ? "Cleared" : "Would clear"}: ${FIX ? cleared : withEmail}   Already empty: ${already}   Errors: ${errors}`);
})().catch(e => { console.error(e); process.exit(1); });
