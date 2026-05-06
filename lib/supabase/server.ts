import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import type { Database } from "@/types/database";

export async function createClient() {
  const cookieStore = await cookies();
  // Forward the active tenant slug (set by middleware) to Supabase so
  // RLS can narrow gods + non-gods to the active subdomain. Without
  // this, current_user_company_ids() falls back to "all companies"
  // for gods and they'd see cross-tenant data on any subdomain.
  let activeSlug: string | null = null;
  try {
    activeSlug = (await headers()).get("x-company-slug");
  } catch {
    // headers() throws outside the request lifecycle (e.g. cron jobs)
    // — that's fine, the RLS function falls back to default behavior.
  }
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {}
        },
      },
      ...(activeSlug ? { global: { headers: { "x-company-slug": activeSlug } } } : {}),
    }
  );
}
