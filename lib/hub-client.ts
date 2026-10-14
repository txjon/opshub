import { createClient as createServerClient } from "@/lib/supabase/server";

// The ONE way client-hub APIs resolve a client from a portal token.
//
// Rule: token + client_hub_enabled — a disabled hub is dark to the public
// (404s as "Invalid link" on every surface). EXCEPTION: a signed-in OpsHub
// user may open a dark hub — that's the pre-launch preview workflow (build
// the client's view, review it, THEN flip client_hub_enabled). The bypass
// rides the caller's own session cookie, so it works from the browser and
// never for a bare token link.
export async function hubClientLookup(db: any, token: string, cols: string): Promise<{ data: any }> {
  const { data } = await db.from("clients").select(cols)
    .eq("portal_token", token).eq("client_hub_enabled", true).maybeSingle();
  if (data) return { data };
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) {
      const { data: dark } = await db.from("clients").select(cols).eq("portal_token", token).maybeSingle();
      if (dark) return { data: dark };
    }
  } catch {}
  return { data: null };
}

// Client info page (hub /company): VIEW-ONLY by default (Jon, Oct 14 2026 —
// a forwarded hub link must never be able to change a ship-to or billing
// address). It opens for editing only while an info request staff emailed
// this client is fresh, or for a signed-in OpsHub user (preview).
export const INFO_REQUEST_DAYS = 30;
export const INFO_UPDATE_EMAIL = "hello@housepartydistro.com";
export async function infoFormEditable(db: any, clientId: string): Promise<boolean> {
  try {
    const sb = await createServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (user) return true;
  } catch {}
  const since = new Date(Date.now() - INFO_REQUEST_DAYS * 864e5).toISOString();
  const { data, error } = await db.from("mail_log").select("id").eq("kind", "client_info_request").eq("meta->>client_id", clientId).gte("created_at", since).limit(1);
  if (error) throw new Error(error.message);
  return !!data?.length;
}
