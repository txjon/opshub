#!/usr/bin/env node
/**
 * Diagnostic for a single QB invoice. Read-only.
 * Usage: node scripts/diag-qb-invoice.js <qbInvoiceId>
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const QB_MINOR_VERSION = "73";

const [, , qbInvoiceId] = process.argv;
if (!qbInvoiceId) { console.error("Usage: node scripts/diag-qb-invoice.js <qbInvoiceId>"); process.exit(1); }

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

async function qb(access, realm, path) {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${QB_BASE_URL}/v3/company/${realm}${path}${sep}minorversion=${QB_MINOR_VERSION}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${access}`, Accept: "application/json" } });
  const tid = res.headers.get("intuit_tid");
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${path} ${res.status} (tid ${tid}): ${text}`);
  }
  return res.json();
}

(async () => {
  const { access, realm } = await getAccessToken();
  console.log(`Realm: ${realm}\n`);

  // Read invoice
  const inv = (await qb(access, realm, `/invoice/${qbInvoiceId}`)).Invoice;
  if (!inv) { console.error("Invoice not found"); process.exit(1); }
  console.log("─── INVOICE ───");
  console.log(`Id:               ${inv.Id}`);
  console.log(`DocNumber:        ${inv.DocNumber}`);
  console.log(`SyncToken:        ${inv.SyncToken}`);
  console.log(`Balance:          $${inv.Balance}`);
  console.log(`TotalAmt:         $${inv.TotalAmt}`);
  console.log(`TxnDate:          ${inv.TxnDate}`);
  console.log(`DueDate:          ${inv.DueDate}`);
  console.log(`EmailStatus:      ${inv.EmailStatus}`);
  console.log(`BillEmail:        ${JSON.stringify(inv.BillEmail) || "(none)"}`);
  console.log(`BillEmailCc:      ${JSON.stringify(inv.BillEmailCc) || "(none)"}`);
  console.log(`BillEmailBcc:     ${JSON.stringify(inv.BillEmailBcc) || "(none)"}`);
  console.log(`InvoiceLink:      ${inv.InvoiceLink || "(empty)"}`);
  console.log(`AllowOnlineCC:    ${inv.AllowOnlineCreditCardPayment}`);
  console.log(`AllowOnlineACH:   ${inv.AllowOnlineACHPayment}`);
  console.log(`CustomerRef:      ${JSON.stringify(inv.CustomerRef)}`);
  console.log(`SalesTermRef:     ${JSON.stringify(inv.SalesTermRef)}`);
  console.log(`CustomerMemo:     ${JSON.stringify(inv.CustomerMemo)}`);
  console.log(`PrintStatus:      ${inv.PrintStatus}`);
  console.log(`DeliveryInfo:     ${JSON.stringify(inv.DeliveryInfo)}`);
  console.log(`MetaData:         ${JSON.stringify(inv.MetaData)}`);
  console.log("");
  console.log(`Lines: ${inv.Line?.length || 0}`);
  for (const ln of (inv.Line || [])) {
    console.log(`  [${ln.LineNum}] ${ln.DetailType} amt=${ln.Amount} desc="${ln.Description}" item=${JSON.stringify(ln.SalesItemLineDetail?.ItemRef)} qty=${ln.SalesItemLineDetail?.Qty} price=${ln.SalesItemLineDetail?.UnitPrice}`);
  }
  console.log("");

  // Read customer
  const custId = inv.CustomerRef?.value;
  if (custId) {
    const cust = (await qb(access, realm, `/customer/${custId}`)).Customer;
    console.log("─── CUSTOMER ───");
    console.log(`Id:               ${cust.Id}`);
    console.log(`DisplayName:      ${cust.DisplayName}`);
    console.log(`Active:           ${cust.Active}`);
    console.log(`PrimaryEmailAddr: ${JSON.stringify(cust.PrimaryEmailAddr) || "(none)"}`);
    console.log(`PrimaryPhone:     ${JSON.stringify(cust.PrimaryPhone) || "(none)"}`);
    console.log(`BillAddr:         ${JSON.stringify(cust.BillAddr) || "(none)"}`);
    console.log(`Job:              ${cust.Job || false}`);
    console.log(`ParentRef:        ${JSON.stringify(cust.ParentRef) || "(none)"}`);
    console.log(`PreferredDelivery:${cust.PreferredDeliveryMethod || "(default)"}`);
  }
})().catch(e => { console.error("ERROR:", e.message); process.exit(1); });
