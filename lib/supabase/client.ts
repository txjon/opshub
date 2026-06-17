import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";
import { resolveSlugFromHost, DEFAULT_SLUG } from "@/lib/tenants";

export function createClient() {
  // Client-side can't read request headers, but window.location.hostname
  // tells us the subdomain → slug (map in lib/tenants.ts).
  const slug = typeof window === "undefined" ? DEFAULT_SLUG : resolveSlugFromHost(window.location.hostname);
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { "x-company-slug": slug } } }
  );
}
