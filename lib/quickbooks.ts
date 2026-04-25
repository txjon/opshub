/**
 * QuickBooks Online API client.
 * Handles OAuth, token refresh, and API calls.
 */

import { createClient } from "@supabase/supabase-js";

const QB_BASE_URL = "https://quickbooks.api.intuit.com";
const QB_AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const QB_TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

// ── OAuth helpers ──

export function getAuthUrl(): string {
  const params = new URLSearchParams({
    client_id: process.env.QB_CLIENT_ID!,
    response_type: "code",
    scope: "com.intuit.quickbooks.accounting com.intuit.quickbooks.payment",
    redirect_uri: process.env.QB_REDIRECT_URI!,
    state: "opshub_connect",
  });
  return `${QB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token: string;
  expires_in: number;
}> {
  const auth = Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: process.env.QB_REDIRECT_URI!,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Token management ──

export async function saveTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  realmId?: string
) {
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const realm = realmId || process.env.QB_REALM_ID;

  // Upsert — always one row
  const { data: existing } = await supabase
    .from("qb_tokens")
    .select("id")
    .limit(1)
    .single();

  if (existing) {
    await supabase.from("qb_tokens").update({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      realm_id: realm,
      updated_at: new Date().toISOString(),
    }).eq("id", existing.id);
  } else {
    await supabase.from("qb_tokens").insert({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_at: expiresAt,
      realm_id: realm,
    });
  }
}

async function getTokens(): Promise<{
  access_token: string;
  refresh_token: string;
  expires_at: string;
} | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from("qb_tokens")
    .select("*")
    .limit(1)
    .single();
  return data;
}

async function refreshAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) throw new Error("No QB tokens — connect QuickBooks first");

  const auth = Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
  ).toString("base64");

  const res = await fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  await saveTokens(data.access_token, data.refresh_token, data.expires_in);
  return data.access_token;
}

// Get a valid access token (refresh if needed)
export async function getAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) throw new Error("No QB tokens — connect QuickBooks first");

  // Refresh if within 5 minutes of expiry
  const expiresAt = new Date(tokens.expires_at).getTime();
  const buffer = 5 * 60 * 1000; // 5 minutes
  if (Date.now() > expiresAt - buffer) {
    return refreshAccessToken();
  }

  return tokens.access_token;
}

// ── API calls ──

// QB minor versions gate which fields appear in responses. 73 surfaces
// InvoiceLink (the customer-facing connect.intuit.com URL) on invoice
// reads. Without this, the field comes back undefined even when QB has
// minted one — which is why OpsHub stored empty / legacy URLs.
const QB_MINOR_VERSION = "73";

async function qbFetch(
  endpoint: string,
  options: { method?: string; body?: any } = {}
): Promise<any> {
  const token = await getAccessToken();
  const tokens = await getTokens();
  const realmId = tokens?.realm_id || process.env.QB_REALM_ID;
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${QB_BASE_URL}/v3/company/${realmId}${endpoint}${sep}minorversion=${QB_MINOR_VERSION}`;

  const res = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  // Log intuit_tid for debugging
  const tid = res.headers.get("intuit_tid");
  if (tid) console.log(`[QB API] ${endpoint} intuit_tid: ${tid}`);

  // Auto-retry on 401 — refresh token and try once more
  if (res.status === 401) {
    console.log(`[QB API] 401 on ${endpoint} — refreshing token and retrying`);
    const newToken = await refreshAccessToken();
    const retry = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!retry.ok) {
      const text = await retry.text();
      console.error(`[QB API Error] ${endpoint} (after refresh): ${retry.status} ${text}`);
      throw new Error(`QB API error: ${retry.status} ${text}`);
    }
    return retry.json();
  }

  if (!res.ok) {
    const text = await res.text();
    console.error(`[QB API Error] ${endpoint}: ${res.status} ${text}`);
    throw new Error(`QB API error: ${res.status} ${text}`);
  }

  return res.json();
}

// ── Customer operations ──

export async function searchCustomer(name: string): Promise<any | null> {
  const query = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName = '${name.replace(/'/g, "\\'")}'`);
  const data = await qbFetch(`/query?query=${query}`);
  const customers = data?.QueryResponse?.Customer;
  return customers?.length > 0 ? customers[0] : null;
}

export async function createCustomer(name: string, email?: string): Promise<any> {
  const body: any = { DisplayName: name };
  if (email) body.PrimaryEmailAddr = { Address: email };
  const data = await qbFetch("/customer", { method: "POST", body });
  return data.Customer;
}

export async function getOrCreateCustomer(name: string, email?: string): Promise<any> {
  let customer = await searchCustomer(name);
  if (!customer) {
    customer = await createCustomer(name, email);
  }
  return customer;
}

// ── Invoice operations ──

export type QBLineItem = {
  description: string;
  qty: number;
  unitPrice: number;
  itemName: string; // QB Product/Service name (e.g. "Tees")
};

export async function createInvoice(
  customerId: string,
  lineItems: QBLineItem[],
  options: {
    terms?: string;
    shipAddress?: string;
    memo?: string;
    email?: string;
  } = {}
): Promise<{ invoiceId: string; invoiceNumber: string; paymentLink: string; taxAmount: number; totalWithTax: number }> {
  // Look up QB item IDs for each product/service name
  const itemCache: Record<string, string> = {};
  for (const li of lineItems) {
    if (!itemCache[li.itemName]) {
      const query = encodeURIComponent(`SELECT * FROM Item WHERE Name = '${li.itemName.replace(/'/g, "\\'")}'`);
      const data = await qbFetch(`/query?query=${query}`);
      const items = data?.QueryResponse?.Item;
      if (items?.length > 0) {
        itemCache[li.itemName] = items[0].Id;
      }
    }
  }

  const lines = lineItems.map((li, i) => ({
    LineNum: i + 1,
    Amount: li.qty * li.unitPrice,
    DetailType: "SalesItemLineDetail",
    Description: li.description,
    SalesItemLineDetail: {
      ItemRef: itemCache[li.itemName]
        ? { value: itemCache[li.itemName], name: li.itemName }
        : { value: "1", name: li.itemName }, // fallback
      Qty: li.qty,
      UnitPrice: li.unitPrice,
    },
  }));

  // Map payment terms
  const termsMap: Record<string, string> = {
    net_15: "Net 15",
    net_30: "Net 30",
    deposit_balance: "Due on receipt",
    prepaid: "Due on receipt",
  };

  const body: any = {
    CustomerRef: { value: customerId },
    Line: lines,
    AllowOnlineCreditCardPayment: true,
    AllowOnlineACHPayment: true,
  };

  if (options.terms && termsMap[options.terms]) {
    // QB uses SalesTermRef — need to look up term ID
    const termName = termsMap[options.terms];
    const tQuery = encodeURIComponent(`SELECT * FROM Term WHERE Name = '${termName}'`);
    const tData = await qbFetch(`/query?query=${tQuery}`);
    const terms = tData?.QueryResponse?.Term;
    if (terms?.length > 0) {
      body.SalesTermRef = { value: terms[0].Id };
    }
  }

  if (options.shipAddress) {
    // Parse address string into QB ShipAddr object
    const parts = options.shipAddress.split(",").map(s => s.trim());
    body.ShipAddr = {
      Line1: parts[0] || "",
      City: parts[1] || "",
      CountrySubDivisionCode: parts[2]?.replace(/\s*\d{5}.*/, "").trim() || "",
      PostalCode: (parts[2] || "").match(/\d{5}/)?.[0] || "",
    };
  }

  if (options.memo) {
    body.CustomerMemo = { value: options.memo };
  }

  // Deliberately do NOT set BillEmail on the invoice. With no invoice-level
  // email, QB has nowhere to send payment confirmation receipts — OpsHub
  // sends its own "payment received" email when a payment is recorded.
  // The payment link itself does not depend on BillEmail; /send is targeted
  // at an internal address below to generate the link.

  const data = await qbFetch("/invoice", { method: "POST", body });
  const invoice = data.Invoice;
  console.log("[QB] Invoice created:", JSON.stringify({ Id: invoice.Id, DocNumber: invoice.DocNumber, TxnTaxDetail: invoice.TxnTaxDetail }));

  // Read invoice back to get tax calculation
  const readBack = await qbFetch(`/invoice/${invoice.Id}`);
  const fullInvoice = readBack.Invoice || invoice;
  const taxAmount = fullInvoice.TxnTaxDetail?.TotalTax || 0;
  const totalWithTax = (fullInvoice.TotalAmt || 0);

  // Payment link must come from InvoiceLink (customer-facing connect.intuit.com
  // portal URL). Do NOT fabricate a fallback — the old /app/invoices/pay?txnId=
  // URL is the logged-in admin screen and 404s for customers.
  //
  // Delegate to refreshPaymentLink — it already handles: existing valid link,
  // /send via internal hello@, retry-read with backoff for QB's empty-response
  // quirk, and fallback to the customer email when QB refuses internal /send.
  const paymentLink = await refreshPaymentLink(invoice.Id, options.email);
  console.log("[QB] Invoice created — InvoiceLink:", paymentLink || "(still empty)");

  return {
    invoiceId: invoice.Id,
    invoiceNumber: fullInvoice.DocNumber || String(invoice.Id),
    paymentLink,
    taxAmount,
    totalWithTax,
  };
}

// ── Payment link refresh ──
// Ensure a QB invoice has a current customer-facing payment link.
// Returns the best link we can get without modifying invoice content.
// Use cases: email send path (make sure the "Pay online" button works),
// portal render (Orders tab pay button).
//
// QB's InvoiceLink is the customer-facing connect.intuit.com URL. It's
// only minted when /invoice/{id}/send is called. Legacy invoices may
// have stored the /app/invoices/pay admin URL (which 404s for customers
// without QB login) — we detect that and force a re-mint.
export async function refreshPaymentLink(invoiceId: string, customerEmail?: string): Promise<string> {
  const existing = await qbFetch(`/invoice/${invoiceId}`);
  const invoice = existing?.Invoice;
  if (!invoice) throw new Error("Invoice not found in QuickBooks");

  const current: string = invoice.InvoiceLink || "";
  const isLegacyAdminUrl = current.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
  if (current && !isLegacyAdminUrl) return current;

  // Mint a fresh link via /send. First try internal hello@ — keeps the
  // customer from getting a duplicate QB-template email on the happy path.
  const internalSendEmail = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

  async function sendAndRead(toEmail: string): Promise<string> {
    let sendResult: any;
    try {
      sendResult = await qbFetch(`/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(toEmail)}`, { method: "POST" });
    } catch (e) {
      // Surface QB's full response at the business-logic layer so we can
      // diagnose why a specific invoice+recipient combo is refused. The
      // underlying qbFetch also logs [QB API Error] with the body.
      console.error(`[QB] /send rejected — invoice=${invoiceId} recipient=${toEmail}: ${(e as any).message}`);
      throw e;
    }
    let link = sendResult?.Invoice?.InvoiceLink || "";
    // QB quirk: /send response sometimes omits InvoiceLink even though
    // the link was minted. Retry the read with small backoff.
    for (let i = 0; i < 4 && !link; i++) {
      await new Promise(r => setTimeout(r, 400 * (i + 1)));
      const retry = await qbFetch(`/invoice/${invoiceId}`);
      link = retry?.Invoice?.InvoiceLink || "";
    }
    return link;
  }

  // Each attempt is independently try/caught — a thrown 500 on the
  // internal send must NOT short-circuit the customer-email fallback.
  let refreshed = "";
  try {
    refreshed = await sendAndRead(internalSendEmail);
  } catch (e) {
    console.log("[QB] refreshPaymentLink internal send threw:", (e as any).message);
  }

  // Fallback: when internal send returned empty or threw, try the actual
  // customer email (BillEmail on the invoice, or caller-provided). QB
  // sometimes refuses /send to an unrelated internal address but accepts
  // the customer's own email and mints the link.
  if (!refreshed) {
    const billEmail: string = invoice?.BillEmail?.Address || "";
    const fallbackEmail = billEmail || customerEmail || "";
    if (fallbackEmail && fallbackEmail.toLowerCase() !== internalSendEmail.toLowerCase()) {
      try {
        refreshed = await sendAndRead(fallbackEmail);
      } catch (e) {
        console.log("[QB] refreshPaymentLink fallback send threw:", (e as any).message);
      }
    }
  }

  return refreshed || current;
}

export async function updateInvoice(
  invoiceId: string,
  lineItems: QBLineItem[],
  options: { memo?: string; shipAddress?: string; email?: string } = {}
): Promise<{ taxAmount: number; totalWithTax: number; paymentLink: string }> {
  // Fetch existing invoice to get SyncToken (required for updates)
  const existing = await qbFetch(`/invoice/${invoiceId}`);
  const invoice = existing.Invoice;
  if (!invoice) throw new Error("Invoice not found in QuickBooks");

  // Look up QB item IDs
  const itemCache: Record<string, string> = {};
  for (const li of lineItems) {
    if (!itemCache[li.itemName]) {
      const query = encodeURIComponent(`SELECT * FROM Item WHERE Name = '${li.itemName.replace(/'/g, "\\'")}'`);
      const data = await qbFetch(`/query?query=${query}`);
      const items = data?.QueryResponse?.Item;
      if (items?.length > 0) {
        itemCache[li.itemName] = items[0].Id;
      }
    }
  }

  const lines = lineItems.map((li, i) => ({
    LineNum: i + 1,
    Amount: li.qty * li.unitPrice,
    DetailType: "SalesItemLineDetail",
    Description: li.description,
    SalesItemLineDetail: {
      ItemRef: itemCache[li.itemName]
        ? { value: itemCache[li.itemName], name: li.itemName }
        : { value: "1", name: li.itemName },
      Qty: li.qty,
      UnitPrice: li.unitPrice,
    },
  }));

  const body: any = {
    Id: invoiceId,
    SyncToken: invoice.SyncToken,
    sparse: true,
    Line: lines,
  };
  if (options.memo) body.CustomerMemo = { value: options.memo };
  if (options.shipAddress) {
    const parts = options.shipAddress.split(",").map(s => s.trim());
    body.ShipAddr = {
      Line1: parts[0] || "",
      City: parts[1] || "",
      CountrySubDivisionCode: parts[2]?.replace(/\s*\d{5}.*/, "").trim() || "",
      PostalCode: (parts[2] || "").match(/\d{5}/)?.[0] || "",
    };
  }

  const data = await qbFetch("/invoice", { method: "POST", body });
  const updated = data.Invoice;

  // Read back for tax
  const readBack = await qbFetch(`/invoice/${invoiceId}`);
  const full = readBack.Invoice || updated;

  // Re-mint the payment link after an update. The stored InvoiceLink can go
  // stale after a revision (pre-revision content or legacy admin URL).
  // Delegate to refreshPaymentLink for one source of truth on the /send +
  // customer-email-fallback logic.
  const paymentLink = await refreshPaymentLink(invoiceId, options.email);

  console.log("[QB] Invoice updated:", invoiceId, "— InvoiceLink:", paymentLink || "(still empty)");
  return {
    taxAmount: full.TxnTaxDetail?.TotalTax || 0,
    totalWithTax: full.TotalAmt || 0,
    paymentLink,
  };
}

// ── Check connection status ──
export async function isConnected(): Promise<boolean> {
  try {
    const tokens = await getTokens();
    return !!tokens;
  } catch {
    return false;
  }
}
