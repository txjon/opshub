import { createClient } from "@supabase/supabase-js";

// Service-role client whose reads can NEVER be served from Next's fetch
// cache. Next patches global fetch inside route handlers and, in dev, backs
// it with .next/cache/fetch-cache — a Supabase GET cached there kept serving
// deleted rows on the client studio (Aug 4: two ghost briefs on FOG's feed
// after the DB said zero). cache:'no-store' per request is the contract.
export function dbNoStore() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    global: { fetch: (url: any, opts: any = {}) => fetch(url, { ...opts, cache: "no-store" }) },
  });
}
