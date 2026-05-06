import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/types/database";

// Mirror lib/supabase/middleware.ts resolveCompanySlug. Client-side
// can't read request headers but window.location.hostname tells us
// which subdomain we're on, which is enough to pick the slug.
function resolveSlugFromHost(): string {
  if (typeof window === "undefined") return "hpd";
  const h = window.location.hostname.toLowerCase();
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export function createClient() {
  const slug = resolveSlugFromHost();
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { "x-company-slug": slug } } }
  );
}
