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

// ── Webhook payload parsing ──
// Intuit is migrating webhooks from the legacy "eventNotifications /
// dataChangeEvent / entities" shape to a flat CloudEvents array (deadline
// May 15 2026, flipped per-subscription via a toggle in the dev portal).
// parseWebhookEvents accepts EITHER format and normalizes to one flat list,
// so the handler keeps working before and after the toggle is flipped.
//
//   Legacy:  { eventNotifications: [ { realmId, dataChangeEvent: { entities: [ { name, id, operation, lastUpdated } ] } } ] }
//   CloudEvents (array): [ { intuitaccountid, intuitentityid, type: "qbo.<entity>.<operation>.v1", time, ... } ]
//
// HMAC verification (intuit-signature header over the raw body) is unchanged
// between the two formats.
export type QBWebhookEvent = { realmId: string; name: string; id: string; operation: string };

export function parseWebhookEvents(body: any): QBWebhookEvent[] {
  const out: QBWebhookEvent[] = [];
  if (Array.isArray(body)) {
    // New CloudEvents format — a flat array, one entry per entity change
    // (and potentially across multiple companies in one delivery).
    for (const ev of body) {
      // type looks like "qbo.payment.created.v1" → [qbo, payment, created, v1]
      const parts = String(ev?.type || "").split(".");
      const entity = parts[1] || "";
      out.push({
        realmId: String(ev?.intuitaccountid ?? ""),
        id: String(ev?.intuitentityid ?? ""),
        // Capitalize to match the legacy entity casing ("Payment").
        name: entity ? entity.charAt(0).toUpperCase() + entity.slice(1) : "",
        operation: parts[2] || "",
      });
    }
  } else {
    // Legacy format.
    for (const n of body?.eventNotifications || []) {
      const realmId = String(n?.realmId ?? "");
      for (const e of n?.dataChangeEvent?.entities || []) {
        out.push({ realmId, id: String(e?.id ?? ""), name: e?.name || "", operation: e?.operation || "" });
      }
    }
  }
  return out;
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

// QB disconnected two nights running (Nov 2–3 2026, invalid_grant) with no
// trace of what invalidated the token. Every connect / renewal / failure now
// lands in qb_token_events (fingerprints only, never tokens) from whatever
// process did it, saves are checked, and a disconnect emails the owner once.
function tokenFp(t?: string | null): string | null {
  if (!t) return null;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("crypto").createHash("sha256").update(t).digest("hex").slice(0, 10);
}

function tokenHost(): string {
  if (process.env.VERCEL_ENV) return `vercel:${process.env.VERCEL_ENV}:${process.env.VERCEL_URL || ""}`;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  try { return `local:${require("os").hostname()}`; } catch { return "local"; }
}

function tokenCaller(): string {
  const lines = (new Error().stack || "").split("\n").slice(1).map(l => l.trim());
  // Prod bundles are minified, so keep a few frames: the route's chunk path
  // (…/app/api/<route>/route.js) still says who asked.
  const own = /\b(tokenCaller|refreshAccessToken|doRefresh|saveTokens)\b|node:internal|processTicksAndRejections/;
  return lines.filter(l => !own.test(l)).slice(0, 4).map(l => l.replace(/^at /, "")).join(" < ").slice(0, 600);
}

// This server process, so overlapping renewals can be told apart in the log.
const TOKEN_INSTANCE = Math.random().toString(36).slice(2, 10);

async function logTokenEvent(event: string, f: { old?: string | null; new?: string | null; detail?: string; caller?: string } = {}) {
  try {
    const { error } = await getSupabase().from("qb_token_events").insert({
      event, old_fp: tokenFp(f.old), new_fp: tokenFp(f.new), host: tokenHost(), instance: TOKEN_INSTANCE, caller: f.caller || tokenCaller(), detail: f.detail?.slice(0, 1000) ?? null,
    });
    if (error) console.error("[QB token] event log failed:", error.message);
  } catch (e: any) {
    console.error("[QB token] event log failed:", e?.message);
  }
  console.log(`[QB token] ${event} old=${tokenFp(f.old)} new=${tokenFp(f.new)} host=${tokenHost()} instance=${TOKEN_INSTANCE}${f.detail ? ` ${f.detail.slice(0, 200)}` : ""}`);
}

// One email per disconnect: skipped if an alert already went out since the
// last connect or good renewal (a false alarm must not mute the next real
// one). The in-process stamp stops a burst of failing calls from mailing
// repeatedly if the event log itself can't be written.
let lastAlertAt = 0;
async function alertDisconnected(detail: string) {
  try {
    if (Date.now() - lastAlertAt < 6 * 60 * 60 * 1000) return;
    const to = process.env.OWNER_EMAIL;
    if (!to) { console.error("[QB token] disconnected, but OWNER_EMAIL is unset: no alert sent"); return; }
    const { data: last } = await getSupabase().from("qb_token_events").select("event")
      .in("event", ["connect", "refresh", "alert_sent"]).order("at", { ascending: false }).limit(1).maybeSingle();
    if ((last as any)?.event === "alert_sent") return;
    const { resendForSlug } = await import("./resend-client");
    const link = "https://app.housepartydistro.com/api/qb/connect";
    const { error: sendErr } = await resendForSlug("hpd").emails.send({
      from: process.env.EMAIL_FROM_QUOTES || "onboarding@resend.dev",
      to,
      subject: "OpsHub · QuickBooks disconnected",
      html: `<div style="font-family:system-ui,sans-serif;max-width:560px">
  <p style="font-size:15px">QuickBooks rejected OpsHub's login token, so every QuickBooks push and pull is failing until it's reconnected. Nothing was changed.</p>
  <p><a href="${link}" style="font-size:15px;font-weight:600">Reconnect QuickBooks</a></p>
  <p style="font-size:12px;color:#666">${detail.replace(/</g, "&lt;").slice(0, 300)}<br>Token history: qb_token_events.</p>
</div>`,
    });
    if (sendErr) { console.error("[QB token] disconnect alert failed:", sendErr.message); return; }
    lastAlertAt = Date.now();
    await logTokenEvent("alert_sent");
  } catch (e: any) {
    console.error("[QB token] disconnect alert failed:", e?.message);
  }
}

export async function saveTokens(
  accessToken: string,
  refreshToken: string,
  expiresIn: number,
  realmId?: string,
  meta: { event: "connect" | "refresh"; oldRefreshToken?: string; caller?: string; leaseOwner?: string } = { event: "refresh" }
) {
  const caller = meta.caller || tokenCaller(); // before any await: async hops drop the stack
  const supabase = getSupabase();
  const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
  const realm = realmId || process.env.QB_REALM_ID;

  // Upsert — always one row. A failed save used to pass silently, leaving a
  // token QB had already replaced; now it retries once, then throws. A
  // renewal saves only while it still holds the lease (see doRefresh); a
  // connect saves unconditionally. Either way the lease is released.
  const write = async () => {
    const { data: existing, error: rErr } = await supabase.from("qb_tokens").select("id").limit(1).maybeSingle();
    if (rErr) return rErr.message;
    const row = { access_token: accessToken, refresh_token: refreshToken, expires_at: expiresAt, realm_id: realm, refresh_lock_until: null, refresh_lock_owner: null };
    if (!existing) {
      const { data, error } = await supabase.from("qb_tokens").insert(row).select("id");
      return error ? error.message : data?.length ? null : "no row written";
    }
    let q = supabase.from("qb_tokens").update({ ...row, updated_at: new Date().toISOString() }).eq("id", (existing as any).id);
    if (meta.leaseOwner) q = q.eq("refresh_lock_owner", meta.leaseOwner);
    const { data, error } = await q.select("id");
    if (error) return error.message;
    if (!data?.length) return meta.leaseOwner ? "lease lost" : "no row written";
    return null;
  };
  let err = await write();
  if (err && err !== "lease lost") err = await write();
  if (err) {
    await logTokenEvent("save_failed", { old: meta.oldRefreshToken, new: refreshToken, detail: err, caller });
    throw new Error(`QuickBooks issued a new login token but OpsHub couldn't save it (${err}). Reconnect QuickBooks if calls start failing.`);
  }
  lastAlertAt = 0; // working again: the next disconnect alerts
  await logTokenEvent(meta.event, { old: meta.oldRefreshToken, new: refreshToken, caller });
}

async function getTokens(): Promise<{
  id: string;
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

async function postRefresh(refreshToken: string): Promise<Response> {
  const auth = Buffer.from(
    `${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`
  ).toString("base64");
  return fetch(QB_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
    // A hung renewal would stall every QB call on this instance (they share it).
    signal: AbortSignal.timeout(20000),
  });
}

// ── Renewal lease (Nov 4 2026, mig 208) ──
// QB disconnected three nights running; the log showed two renewals
// overlapping at the 1:10am token rotation, and Intuit kills the connection
// when a just-replaced token is renewed again. So a renewal first takes a
// lease on the token row (a conditional update: free or lapsed), and only the
// lease holder calls Intuit and saves. Everyone else waits and uses the token
// the holder saves. The lease outlives the 20s Intuit timeout + the save.
const LEASE_MS = 60_000;
const LEASE_WAIT_MS = 45_000;

async function takeLease(id: string, owner: string): Promise<boolean> {
  const now = new Date();
  const { data, error } = await getSupabase().from("qb_tokens")
    .update({ refresh_lock_until: new Date(now.getTime() + LEASE_MS).toISOString(), refresh_lock_owner: owner })
    .eq("id", id)
    .or(`refresh_lock_until.is.null,refresh_lock_until.lt.${now.toISOString()}`)
    .select("id");
  if (error) throw new Error(`QuickBooks token lease failed: ${error.message}`);
  return !!data?.length;
}

async function releaseLease(id: string, owner: string) {
  // No-op after a save (the save clears the lease).
  try {
    await getSupabase().from("qb_tokens").update({ refresh_lock_until: null, refresh_lock_owner: null }).eq("id", id).eq("refresh_lock_owner", owner);
  } catch { /* lapses on its own */ }
}

// Stored token is good to use: not near expiry, and not the one QB just
// rejected with a 401.
function usable(t: { access_token: string; expires_at: string }, rejected?: string): boolean {
  return new Date(t.expires_at).getTime() - Date.now() > 5 * 60 * 1000 && t.access_token !== rejected;
}

// Callers in the same process share one in-flight renewal.
let refreshInFlight: Promise<string> | null = null;
function refreshAccessToken(rejectedAccessToken?: string): Promise<string> {
  // Name the caller now, before any await: async hops drop the stack.
  if (!refreshInFlight) refreshInFlight = doRefresh(tokenCaller(), rejectedAccessToken).finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function doRefresh(caller: string, rejected?: string): Promise<string> {
  const owner = `${TOKEN_INSTANCE}-${Math.random().toString(36).slice(2, 6)}`;
  const deadline = Date.now() + LEASE_WAIT_MS;
  let tokens = await getTokens();
  if (!tokens) throw new Error("No QB tokens — connect QuickBooks first");
  for (;;) {
    if (usable(tokens, rejected)) return tokens.access_token; // renewed by someone else meanwhile
    if (await takeLease(tokens.id, owner)) break;
    if (Date.now() > deadline) {
      await logTokenEvent("lease_timeout", { old: tokens.refresh_token, caller });
      throw new Error("QuickBooks token renewal is busy in another process. Try again in a minute.");
    }
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 500));
    tokens = await getTokens();
    if (!tokens) throw new Error("No QB tokens — connect QuickBooks first");
  }

  try {
    // Re-read under the lease: a renewal may have finished between our read
    // and taking the lease.
    const fresh = await getTokens();
    if (!fresh) throw new Error("No QB tokens — connect QuickBooks first");
    if (usable(fresh, rejected)) return fresh.access_token;

    let used = fresh.refresh_token;
    await logTokenEvent("refresh_start", { old: used, caller });
    // A timed-out renewal may still have rotated the token at Intuit: log it.
    const post = async (rt: string) => {
      try { return await postRefresh(rt); }
      catch (e: any) {
        await logTokenEvent("refresh_failed", { old: rt, detail: `request failed: ${e?.name || ""} ${e?.message || ""}`, caller });
        throw new Error(`Token refresh failed: QuickBooks didn't answer (${e?.message || e}).`);
      }
    };
    let res = await post(used);
    let rereadOk = true;

    // Should be impossible under the lease, unless a lapsed lease let another
    // renewal in or something outside lib/quickbooks wrote the token: re-read
    // once before declaring QB disconnected.
    if (!res.ok && res.status === 400) {
      const text = await res.clone().text();
      if (text.includes("invalid_grant")) {
        const now = await getTokens();
        if (!now) rereadOk = false; // can't tell; don't call it a disconnect
        if (now && now.refresh_token !== used) {
          await logTokenEvent("refresh_superseded", { old: used, new: now.refresh_token, caller });
          if (usable(now, rejected)) return now.access_token;
          used = now.refresh_token;
          res = await post(used);
        }
      }
    }

    if (!res.ok) {
      const text = await res.text();
      await logTokenEvent("refresh_failed", { old: used, detail: `${res.status} ${text}`, caller });
      if (text.includes("invalid_grant") && rereadOk) await alertDisconnected(`${res.status} ${text}`);
      throw new Error(`Token refresh failed: ${res.status} ${text}`);
    }

    const data = await res.json();
    // saveTokens logs save_failed; this call still holds a valid token, so use
    // it. If QB had issued a NEW refresh token, the next renewal fails and the
    // disconnect alert fires then.
    try {
      await saveTokens(data.access_token, data.refresh_token, data.expires_in, undefined, { event: "refresh", oldRefreshToken: used, caller, leaseOwner: owner });
    } catch (e: any) {
      console.error("[QB token]", e?.message);
    }
    return data.access_token;
  } finally {
    await releaseLease(tokens.id, owner);
  }
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
  const realmId = (tokens as any)?.realm_id || process.env.QB_REALM_ID;
  const sep = endpoint.includes("?") ? "&" : "?";
  const url = `${QB_BASE_URL}/v3/company/${realmId}${endpoint}${sep}minorversion=${QB_MINOR_VERSION}`;

  // 25s per-call cap: when Intuit is degraded (Sep 1: companyinfo itself hung
  // 4+ min → Vercel killed the function at 60s with a plain-text error the UI
  // couldn't parse), fail FAST with a clean message instead.
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(25000),
    });
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError") {
      throw new Error("QuickBooks isn't responding (Intuit API timeout) — try again in a few minutes.");
    }
    throw e;
  }

  // Log intuit_tid for debugging
  const tid = res.headers.get("intuit_tid");
  if (tid) console.log(`[QB API] ${endpoint} intuit_tid: ${tid}`);

  // Auto-retry on 401 — refresh token and try once more
  if (res.status === 401) {
    console.log(`[QB API] 401 on ${endpoint} — refreshing token and retrying`);
    const newToken = await refreshAccessToken(token);
    const retry = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Authorization: `Bearer ${newToken}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: AbortSignal.timeout(25000),
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

// Strip common company suffixes so "Low Rollers Club" matches "Low Rollers
// Club LLC" and similar near-misses. We also lowercase + collapse whitespace
// to make the comparison forgiving against the actual QB DisplayName.
const COMPANY_SUFFIX_RE = /\s*,?\s*(inc|incorporated|llc|l\.l\.c\.|ltd|limited|corp|corporation|co|company|llp|lp|plc|gmbh)\.?(\s|$)/gi;

function normalizeForFuzzy(name: string): string {
  return (name || "")
    .trim()
    .replace(COMPANY_SUFFIX_RE, " ")
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// QB's LIKE is case-insensitive. Without wildcards it acts as a
// case-insensitive equality check, which is exactly what we want for
// "exact match" — "acme inc" should match "Acme Inc".
export async function searchCustomer(name: string): Promise<any | null> {
  const q = (name || "").trim();
  if (!q) return null;
  const query = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName LIKE '${q.replace(/'/g, "\\'")}'`);
  const data = await qbFetch(`/query?query=${query}`);
  const customers = data?.QueryResponse?.Customer;
  return customers?.length > 0 ? customers[0] : null;
}

// Fuzzy substring search. Used by the chooser UI when there's no exact
// match — e.g. OpsHub "Low Rollers Club" surfaces QB "Low Rollers Club LLC"
// as a candidate so we don't silently create a duplicate.
export async function findCustomerCandidates(name: string, limit = 10): Promise<any[]> {
  const core = normalizeForFuzzy(name);
  if (!core) return [];
  const query = encodeURIComponent(`SELECT * FROM Customer WHERE DisplayName LIKE '%${core.replace(/'/g, "\\'")}%' MAXRESULTS ${Math.max(1, Math.min(50, limit))}`);
  const data = await qbFetch(`/query?query=${query}`);
  const customers = data?.QueryResponse?.Customer || [];
  return customers;
}

// Tax status of many QB customers in one read (batched IN queries). QB's
// customer record is THE sales-tax switch (Taxable + resale # + exemption
// reason) — OpsHub mirrors it (lib/client-tax-sync), never the other way
// round except via a verified certificate. Read-only; throws on any transport
// error so a QB outage can never read as "everyone is taxable".
export async function getCustomersTaxStatus(ids: string[]): Promise<Map<string, { taxable: boolean; resaleNum: string | null; exemptionReasonId: string | null; name: string }>> {
  const out = new Map<string, { taxable: boolean; resaleNum: string | null; exemptionReasonId: string | null; name: string }>();
  const uniq = Array.from(new Set(ids.filter(Boolean).map(String)));
  for (let i = 0; i < uniq.length; i += 30) {
    const list = uniq.slice(i, i + 30).map(id => `'${id.replace(/'/g, "")}'`).join(",");
    const data = await qbFetch(`/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE Id IN (${list}) MAXRESULTS 100`)}`);
    for (const c of (data?.QueryResponse?.Customer || []) as any[]) {
      out.set(String(c.Id), { taxable: c.Taxable !== false, resaleNum: c.ResaleNum || null, exemptionReasonId: c.TaxExemptionReasonId || null, name: c.DisplayName || "" });
    }
  }
  return out;
}

// Mark a QB customer sales-tax EXEMPT for resale — the ONLY write OpsHub makes
// to a customer's tax status, and only when staff approve a resale
// certificate a client submitted (lib/client-info approveCertificate). Sparse
// update: Taxable=false + ResaleNum + reason 9 (Resale). QB's ResaleNum holds
// one number (16 chars max), so it carries the approved permit; every
// certificate stays on file in OpsHub.
export async function setCustomerTaxExempt(id: string, resaleNum: string): Promise<{ taxable: boolean; resaleNum: string | null }> {
  const cur = await qbFetch(`/customer/${encodeURIComponent(id)}`);
  const c = cur?.Customer;
  if (!c) throw new Error("QuickBooks customer not found");
  const res = await qbFetch("/customer", {
    method: "POST",
    body: { Id: c.Id, SyncToken: c.SyncToken, sparse: true, Taxable: false, ResaleNum: String(resaleNum || "").slice(0, 16), TaxExemptionReasonId: "9" },
  });
  const u = res?.Customer;
  if (!u) throw new Error("QuickBooks did not confirm the tax update");
  return { taxable: u.Taxable !== false, resaleNum: u.ResaleNum || null };
}

// Full customer records for many ids (30 per query). Throws on any transport
// error — the OpsHub → QB profile sync must never act on a partial read.
export async function getCustomersFull(ids: string[]): Promise<Map<string, any>> {
  const out = new Map<string, any>();
  const uniq = Array.from(new Set(ids.filter(Boolean).map(String)));
  for (let i = 0; i < uniq.length; i += 30) {
    const list = uniq.slice(i, i + 30).map(id => `'${id.replace(/'/g, "")}'`).join(",");
    const data = await qbFetch(`/query?query=${encodeURIComponent(`SELECT * FROM Customer WHERE Id IN (${list}) MAXRESULTS 100`)}`);
    for (const c of (data?.QueryResponse?.Customer || []) as any[]) out.set(String(c.Id), c);
  }
  return out;
}

// Sparse profile update (lib/qb-customer-sync). `build` gets the FRESH record
// (current SyncToken) and returns the fields to send, or null to skip.
export async function updateCustomerProfile(id: string, build: (cur: any) => Record<string, any> | null): Promise<{ before: any; after: any; sent: Record<string, any> | null }> {
  const cur = (await qbFetch(`/customer/${encodeURIComponent(id)}`))?.Customer;
  if (!cur) throw new Error("QuickBooks customer not found");
  const sent = build(cur);
  if (!sent || !Object.keys(sent).length) return { before: cur, after: cur, sent: null };
  const res = await qbFetch("/customer", { method: "POST", body: { Id: cur.Id, SyncToken: cur.SyncToken, sparse: true, ...sent } });
  if (!res?.Customer) throw new Error("QuickBooks did not confirm the update");
  return { before: cur, after: res.Customer, sent };
}

export async function getCustomerById(id: string): Promise<any | null> {
  try {
    const data = await qbFetch(`/customer/${id}`);
    return data?.Customer || null;
  } catch (e: any) {
    // ONLY a definitive "this customer doesn't exist" may return null — the
    // invoice route treats null as deleted-in-QB and severs the job's invoice
    // refs (destructive self-heal). A transport failure must THROW: on Sep 1
    // an Intuit 504 here read as "customer deleted", wiped HPD-2605-047's
    // link to invoice #4284, and the next push minted duplicate #4483.
    const msg = String(e?.message || "");
    if (/object not found|"610"|has been deleted/i.test(msg)) return null;
    throw e;
  }
}

export async function createCustomer(name: string, email?: string): Promise<any> {
  const body: any = { DisplayName: name };
  if (email) body.PrimaryEmailAddr = { Address: email };
  const data = await qbFetch("/customer", { method: "POST", body });
  return data.Customer;
}

// Thrown when no exact-match QB customer exists but fuzzy candidates do.
// Routes catch this and return 409 with the candidate list so the UI can
// pop a chooser instead of letting QB collect duplicate customers.
export class QBAmbiguousCustomerError extends Error {
  candidates: any[];
  searchedName: string;
  constructor(searchedName: string, candidates: any[]) {
    super(`Possible existing QuickBooks customer for "${searchedName}" — ${candidates.length} candidate(s)`);
    this.name = "QBAmbiguousCustomerError";
    this.searchedName = searchedName;
    this.candidates = candidates;
  }
}

export async function getOrCreateCustomer(
  name: string,
  email?: string,
  options: { forceCreate?: boolean } = {}
): Promise<any> {
  // 1) Case-insensitive exact DisplayName match (handles whitespace + case).
  let customer = await searchCustomer(name);
  if (customer) return customer;

  // 2) Retry with company suffix stripped — catches "Acme" ↔ "Acme LLC".
  const core = normalizeForFuzzy(name);
  if (core && core.toLowerCase() !== (name || "").trim().toLowerCase()) {
    customer = await searchCustomer(core);
    if (customer) return customer;
  }

  // 3) Fuzzy LIKE — if QB has anything that looks similar, refuse to
  //    silently create. Caller pops a chooser; user picks one or
  //    re-submits with forceCreate=true.
  if (!options.forceCreate) {
    const candidates = await findCustomerCandidates(name);
    if (candidates.length > 0) {
      throw new QBAmbiguousCustomerError(name, candidates);
    }
  }

  // 4) Truly no match anywhere — safe to create.
  return createCustomer(name, email);
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
    shipAddr?: any;          // QB PhysicalAddress (lib/address qbShipAddr)
    memo?: string;            // CustomerMemo — "Note to customer", shows ON the invoice
    statementMemo?: string;   // PrivateNote — "Memo on statement", hidden from the invoice
    email?: string;
    allowCC?: boolean;       // defaults true
    allowACH?: boolean;      // defaults true
    skipPaymentLink?: boolean; // quiet create: no /send at all (no link, zero emails)
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
    // Per-client toggles flow through here. Default true preserves the
    // pre-flag behavior; set false on options to disable that rail in
    // QB's hosted payment page (e.g., ACH-only client).
    AllowOnlineCreditCardPayment: options.allowCC !== false,
    AllowOnlineACHPayment: options.allowACH !== false,
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

  if (options.shipAddr) body.ShipAddr = options.shipAddr;   // built by lib/address qbShipAddr

  if (options.memo) {
    body.CustomerMemo = { value: options.memo };
  }
  if (options.statementMemo) {
    body.PrivateNote = options.statementMemo;
  }

  // Set BillEmail to internal hello@ — required for /send to mint the
  // customer-facing InvoiceLink without throwing NullPointerException.
  // QB's /send reads BillEmail to record the send action even when sendTo
  // is passed; if BillEmail is empty AND the customer's PreferredDelivery
  // Method is "None", QB hits an internal null path and returns 500.
  // Using the internal sentinel (not the customer's email) keeps QB-side
  // payment-confirmation receipts inside HPD — OpsHub still sends the
  // customer-facing email via Resend.
  body.BillEmail = { Address: process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com" };

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
  // Quiet create: skip the /send-based link mint entirely — /send is the only
  // step that can email anyone (its fallback targets the customer address).
  const paymentLink = options.skipPaymentLink ? "" : await refreshPaymentLink(invoice.Id, options.email);
  console.log("[QB] Invoice created — InvoiceLink:", paymentLink || (options.skipPaymentLink ? "(quiet — link not minted)" : "(still empty)"));

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
  let invoice = existing?.Invoice;
  if (!invoice) throw new Error("Invoice not found in QuickBooks");

  const current: string = invoice.InvoiceLink || "";
  const isLegacyAdminUrl = current.startsWith("https://app.qbo.intuit.com/app/invoices/pay");
  if (current && !isLegacyAdminUrl) return current;

  // Mint a fresh link via /send. First try internal hello@ — keeps the
  // customer from getting a duplicate QB-template email on the happy path.
  const internalSendEmail = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

  // Self-heal: legacy invoices were created with no BillEmail, which makes
  // /send throw 500 NullPointerException for customers whose Preferred
  // Delivery Method is "None". Patch BillEmail to the sentinel before
  // calling /send so the link mints reliably. New invoices already set
  // BillEmail in createInvoice; this is the safety net for old ones.
  if (!invoice?.BillEmail?.Address) {
    try {
      const patched = await qbFetch("/invoice", {
        method: "POST",
        body: { Id: invoice.Id, SyncToken: invoice.SyncToken, sparse: true, BillEmail: { Address: internalSendEmail } },
      });
      invoice = patched?.Invoice || invoice;
      console.log(`[QB] refreshPaymentLink: patched BillEmail on invoice ${invoiceId}`);
    } catch (e) {
      console.log(`[QB] refreshPaymentLink: BillEmail patch failed on ${invoiceId}:`, (e as any).message);
    }
  }

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
  options: { memo?: string; statementMemo?: string; shipAddr?: any; email?: string; allowCC?: boolean; allowACH?: boolean } = {}
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
  // Carry through payment-method flags on every update so changes made
  // in OpsHub propagate to QB. If callers don't pass flags, leave the
  // existing values on the invoice alone.
  if (options.allowCC !== undefined) body.AllowOnlineCreditCardPayment = options.allowCC;
  if (options.allowACH !== undefined) body.AllowOnlineACHPayment = options.allowACH;
  if (options.memo) body.CustomerMemo = { value: options.memo };
  if (options.statementMemo) {
    body.PrivateNote = options.statementMemo;
    // The period label used to go out as CustomerMemo; scrub it on update so
    // older invoices migrate to statement-only when re-pushed. Only the
    // shipstation route passes statementMemo, so job invoices are untouched.
    if (!options.memo) body.CustomerMemo = { value: "" };
  }
  if (options.shipAddr) body.ShipAddr = options.shipAddr;   // built by lib/address qbShipAddr

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

// ── Item (Product/Service) catalog ──
// Backs the custom-invoice-line-item editor: each extra line picks which QB
// Product/Service it posts under (the `qb_item` field). Reading the live
// catalog keeps that dropdown from drifting as items are added or renamed in
// QB — the same names this returns are what createInvoice/updateInvoice look
// up by Name when building line items.
export type QBItem = {
  id: string;
  name: string;
  fullyQualifiedName: string;
  type: string; // Service | NonInventory | Inventory | ...
};

// Curated allowlist of QB items that are valid "Additional charges" targets.
// QB's Type field can't express this cleanly — "Tote" is Service-typed but is
// a product, while "Postage" is a fee but isn't Service-typed — so we scope by
// name instead. Still reads the live catalog (reflects active/renamed items);
// add a new fee item here when one is created in QB.
const ADDITIONAL_CHARGE_ITEMS = new Set([
  "art services",
  "fulfillment",
  "inventory warehousing",
  "postage",
  "service fee",
]);

export async function listItems(): Promise<QBItem[]> {
  // QB caps query results at 1000 rows; the HPD catalog is well under that.
  // Active = true drops archived items; the allowlist then narrows to the
  // fee/passthrough items an Additional charges line can map to.
  const query = encodeURIComponent("SELECT * FROM Item WHERE Active = true MAXRESULTS 1000");
  const data = await qbFetch(`/query?query=${query}`);
  const items = data?.QueryResponse?.Item || [];
  return items
    .filter((it: any) => ADDITIONAL_CHARGE_ITEMS.has(String(it?.Name || "").trim().toLowerCase()))
    .map((it: any) => ({
      id: String(it.Id),
      name: it.Name || "",
      fullyQualifiedName: it.FullyQualifiedName || it.Name || "",
      type: it.Type || "",
    }))
    .sort((a: QBItem, b: QBItem) => a.name.localeCompare(b.name));
}

// ── Void an invoice ──
// Voiding (not deleting) a cancelled-before-payment invoice keeps the doc
// number in QB's audit trail at $0 — standard accounting practice. We read the
// live invoice first and REFUSE if any payment is applied (balance < total),
// so a QB-side payment that OpsHub hasn't synced can't be silently wiped.
export async function voidInvoice(invoiceId: string): Promise<{ voided: boolean; alreadyVoid: boolean; totalAmt: number; balance: number }> {
  const existing = await qbFetch(`/invoice/${invoiceId}`);
  const inv = existing?.Invoice;
  if (!inv) throw new Error("Invoice not found in QuickBooks");
  const totalAmt = Number(inv.TotalAmt) || 0;
  const balance = Number(inv.Balance) || 0;

  // A voided invoice in QB is zeroed (TotalAmt 0). Treat as already handled.
  if (totalAmt <= 0.005) {
    return { voided: false, alreadyVoid: true, totalAmt, balance };
  }
  // Balance below total ⇒ a payment was applied. Refuse to void.
  if (balance < totalAmt - 0.005) {
    throw new Error(`Invoice has a payment applied in QuickBooks (balance $${balance.toFixed(2)} of $${totalAmt.toFixed(2)}) — cannot void`);
  }

  const data = await qbFetch(`/invoice?operation=void`, { method: "POST", body: { Id: inv.Id, SyncToken: inv.SyncToken } });
  const v = data?.Invoice || {};
  return { voided: true, alreadyVoid: false, totalAmt: Number(v.TotalAmt) || 0, balance: Number(v.Balance) || 0 };
}

// ── Vendor operations (AP — for the Bill write-path) ──

export async function searchVendor(name: string): Promise<any | null> {
  const q = (name || "").trim();
  if (!q) return null;
  const query = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName LIKE '${q.replace(/'/g, "\\'")}'`);
  const data = await qbFetch(`/query?query=${query}`);
  const vendors = data?.QueryResponse?.Vendor;
  return vendors?.length > 0 ? vendors[0] : null;
}

export async function findVendorCandidates(name: string, limit = 10): Promise<any[]> {
  const core = normalizeForFuzzy(name);
  if (!core) return [];
  const query = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName LIKE '%${core.replace(/'/g, "\\'")}%' MAXRESULTS ${Math.max(1, Math.min(50, limit))}`);
  const data = await qbFetch(`/query?query=${query}`);
  return data?.QueryResponse?.Vendor || [];
}

export async function createVendor(name: string): Promise<any> {
  const data = await qbFetch("/vendor", { method: "POST", body: { DisplayName: name } });
  return data.Vendor;
}

// Free-text vendor search for the contractor → QB-vendor mapping picker (mirrors
// the customer-candidates flow). Contains-match on DisplayName so "sandate" finds
// "Patrick Samuel Sandate".
export async function searchVendors(q: string, limit = 20): Promise<{ id: string; name: string }[]> {
  const s = (q || "").trim();
  if (!s) return [];
  const query = encodeURIComponent(`SELECT * FROM Vendor WHERE DisplayName LIKE '%${s.replace(/'/g, "\\'")}%' AND Active = true MAXRESULTS ${Math.max(1, Math.min(50, limit))}`);
  const data = await qbFetch(`/query?query=${query}`);
  return (data?.QueryResponse?.Vendor || []).map((v: any) => ({ id: String(v.Id), name: v.DisplayName }));
}

// Resolve an OpsHub AP vendor to a QB Vendor. These almost always already exist
// in QB (they show up in the bill/transaction reports), so we match exact →
// suffix-stripped → closest fuzzy before creating. Unlike the customer path we
// don't pop a chooser — the Bill push is manual + reviewable, and the resolved
// qb_vendor_id is cached on ap_vendors so this only runs once per vendor.
export async function getOrCreateVendor(name: string): Promise<any> {
  let vendor = await searchVendor(name);
  if (vendor) return vendor;
  const core = normalizeForFuzzy(name);
  if (core && core.toLowerCase() !== (name || "").trim().toLowerCase()) {
    vendor = await searchVendor(core);
    if (vendor) return vendor;
  }
  const candidates = await findVendorCandidates(name);
  if (candidates.length > 0) return candidates[0];
  return createVendor(name);
}

// ── Account lookup ──

// Every decorator/printer bill posts to a single COGS account (confirmed: each
// QB transaction report shows "Cost of Goods Sold" as the distribution account).
// Resolve its ref once; callers cache it.
export async function getCogsAccountRef(): Promise<{ id: string; name: string }> {
  const query = encodeURIComponent("SELECT * FROM Account WHERE AccountType = 'Cost of Goods Sold' AND Active = true MAXRESULTS 10");
  const data = await qbFetch(`/query?query=${query}`);
  const accounts = data?.QueryResponse?.Account || [];
  const exact = accounts.find((a: any) => String(a.Name || "").toLowerCase() === "cost of goods sold");
  const acct = exact || accounts[0];
  if (!acct) throw new Error("No 'Cost of Goods Sold' account found in QuickBooks");
  return { id: String(acct.Id), name: acct.Name };
}

// Resolve a QB account by name (exact match first, then fuzzy contains). Used for
// the contractor-labor account ("3rd party fulfillment").
export async function getAccountRefByName(name: string): Promise<{ id: string; name: string }> {
  const esc = name.replace(/'/g, "\\'");
  let data = await qbFetch(`/query?query=${encodeURIComponent(`SELECT * FROM Account WHERE Name = '${esc}' AND Active = true MAXRESULTS 5`)}`);
  let accounts = data?.QueryResponse?.Account || [];
  if (!accounts.length) {
    data = await qbFetch(`/query?query=${encodeURIComponent("SELECT * FROM Account WHERE Active = true MAXRESULTS 1000")}`);
    const lc = name.toLowerCase();
    accounts = (data?.QueryResponse?.Account || []).filter((a: any) => String(a.Name || "").toLowerCase().includes(lc));
  }
  const acct = accounts[0];
  if (!acct) throw new Error(`No active QuickBooks account matching "${name}" found`);
  return { id: String(acct.Id), name: acct.Name };
}

// ── Bill operations (AP write-path) ──

export type QBBillLine = {
  amount: number;
  description: string;      // PO ref / item, e.g. "4143-JK Warlord Patch"
  customerId?: string;      // QB Customer id → job-costing link (the OpsHub edge)
};

// Create a QB Bill (accounts-payable). Every line posts to the COGS account;
// CustomerRef ties each line to the job's client for cost-by-customer reporting
// (NotBillable — OpsHub owns client invoicing, so these costs are tracked, not
// re-billed through QB). Returns the new Bill id + doc number + total.
export async function createBill(params: {
  vendorId: string;
  accountId: string;
  lines: QBBillLine[];
  docNumber?: string;       // vendor invoice #
  txnDate?: string;         // YYYY-MM-DD
  privateNote?: string;     // memo (e.g. OpsHub job + PO refs)
}): Promise<{ billId: string; docNumber: string | null; total: number }> {
  const Line = params.lines.map((l) => ({
    DetailType: "AccountBasedExpenseLineDetail",
    Amount: Math.round(Number(l.amount || 0) * 100) / 100,
    Description: l.description,
    AccountBasedExpenseLineDetail: {
      AccountRef: { value: params.accountId },
      ...(l.customerId
        ? { CustomerRef: { value: l.customerId }, BillableStatus: "NotBillable" }
        : {}),
    },
  }));
  const body: any = { VendorRef: { value: params.vendorId }, Line };
  if (params.docNumber) body.DocNumber = params.docNumber;
  if (params.txnDate) body.TxnDate = params.txnDate;
  if (params.privateNote) body.PrivateNote = params.privateNote;
  const data = await qbFetch("/bill", { method: "POST", body });
  const bill = data?.Bill;
  if (!bill?.Id) throw new Error("QB Bill creation returned no id");
  return { billId: String(bill.Id), docNumber: bill.DocNumber || null, total: Number(bill.TotalAmt) || 0 };
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
