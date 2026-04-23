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

async function qbFetch(
  endpoint: string,
  options: { method?: string; body?: any } = {}
): Promise<any> {
  const token = await getAccessToken();
  const tokens = await getTokens();
  const realmId = tokens?.realm_id || process.env.QB_REALM_ID;
  const url = `${QB_BASE_URL}/v3/company/${realmId}${endpoint}`;

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
  // URL is the logged-in admin screen and 404s for customers. Missing link
  // returns empty string; callers/UI hide the "Pay Online" CTA.
  //
  // /send is what tells QB to mint an InvoiceLink, but it also emails the
  // invoice to the sendTo address. Always target an internal address so
  // clients never receive a QB-side invoice email — OpsHub sends its own
  // branded invoice email.
  let paymentLink = fullInvoice.InvoiceLink || "";
  if (!paymentLink) {
    const internalSendEmail = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
    try {
      const sendResult = await qbFetch(`/invoice/${invoice.Id}/send?sendTo=${encodeURIComponent(internalSendEmail)}`, { method: "POST" });
      paymentLink = sendResult?.Invoice?.InvoiceLink || "";
      // QB occasionally returns the invoice from /send without InvoiceLink populated.
      // One retry read covers that race.
      if (!paymentLink) {
        const retry = await qbFetch(`/invoice/${invoice.Id}`);
        paymentLink = retry?.Invoice?.InvoiceLink || "";
      }
      console.log("[QB] Invoice sent (internal), InvoiceLink:", paymentLink || "(still empty)");
    } catch (e) {
      console.log("[QB] Could not send invoice for payment link:", (e as any).message);
    }
  }

  return {
    invoiceId: invoice.Id,
    invoiceNumber: fullInvoice.DocNumber || String(invoice.Id),
    paymentLink,
    taxAmount,
    totalWithTax,
  };
}

// ── Update existing invoice ──
export async function updateInvoice(
  invoiceId: string,
  lineItems: QBLineItem[],
  options: { memo?: string; shipAddress?: string } = {}
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

  // Re-mint the payment link on every update. The stored InvoiceLink on QB
  // can go stale after a revision — the old link may point at pre-revision
  // content, or (historically) may have been the legacy /app/invoices/pay
  // admin URL that 404s for customers. Calling /send here forces QB to
  // return a current customer-facing connect.intuit.com URL.
  // sendTo points at an internal address — customers never get this mail;
  // OpsHub ships its own branded invoice email separately.
  const current: string = full.InvoiceLink || "";
  const isLegacyAdminUrl = current.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
  let paymentLink: string = current;
  const shouldRefresh = !paymentLink || isLegacyAdminUrl;
  if (shouldRefresh) {
    const internalSendEmail = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
    try {
      const sendResult = await qbFetch(`/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(internalSendEmail)}`, { method: "POST" });
      const refreshed = sendResult?.Invoice?.InvoiceLink || "";
      if (refreshed) {
        paymentLink = refreshed;
      } else {
        const retry = await qbFetch(`/invoice/${invoiceId}`);
        paymentLink = retry?.Invoice?.InvoiceLink || current;
      }
      console.log("[QB] Invoice update — refreshed InvoiceLink:", paymentLink || "(still empty)");
    } catch (e) {
      console.log("[QB] Update: could not refresh payment link:", (e as any).message);
      // Keep whatever was there — at least send a stable (if stale) URL.
      paymentLink = current;
    }
  }

  console.log("[QB] Invoice updated:", invoiceId);
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
