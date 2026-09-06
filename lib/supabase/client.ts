import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { resolveSlugFromHost, DEFAULT_SLUG } from "@/lib/tenants";

export function createClient(): SupabaseClient<Database> {
  // Client-side can't read request headers, but window.location.hostname
  // tells us the subdomain → slug (map in lib/tenants.ts).
  const slug = typeof window === "undefined" ? DEFAULT_SLUG : resolveSlugFromHost(window.location.hostname);
  // @supabase/ssr 0.5.1's generics silently degrade every table to `never`
  // (types/database.ts is valid — raw supabase-js resolves it fine). Assert
  // the return to the properly-typed client; zero runtime change. Remove the
  // assertion when @supabase/ssr is upgraded past the generics bug.
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { "x-company-slug": slug } } }
  ) as unknown as SupabaseClient<Database>;
}
