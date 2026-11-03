#!/usr/bin/env node
// Disconnect OpsHub from QuickBooks by revoking its token at Intuit (Nov 3
// 2026: rotate after the qb_tokens anon exposure). Revoking the refresh token
// kills it and its access token, so any copy anyone took is dead. QuickBooks
// is DISCONNECTED until you reconnect at app.housepartydistro.com/api/qb/connect.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data: tok, error } = await db.from("qb_tokens").select("refresh_token").limit(1).single();
  if (error || !tok) { console.error("Couldn't read the token:", error?.message); process.exit(1); }
  const auth = Buffer.from(`${process.env.QB_CLIENT_ID}:${process.env.QB_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://developer.api.intuit.com/v2/oauth2/tokens/revoke", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ token: tok.refresh_token }),
  });
  if (!res.ok) { console.error(`Revoke failed: ${res.status} ${await res.text()}`); process.exit(1); }
  await db.from("qb_token_events").insert({ event: "revoked", host: "script:qb-revoke", detail: "manual rotation after anon exposure" });
  console.log("✓ OpsHub disconnected from QuickBooks. Now reconnect: https://app.housepartydistro.com/api/qb/connect");
})();
