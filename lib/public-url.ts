// Canonical public URL for outgoing emails and any links clients/vendors see.
//
// Tenant-aware: each company has its own subdomain, so portal/auth/share
// links must point at the user's actual host instead of a single shared
// preview URL. Resolution order:
//
//   1. Client-side (browser): window.location.origin — the user is
//      already on their tenant's domain, this is always correct.
//   2. Server-side: read x-company-slug from request headers (stamped
//      by lib/supabase/middleware.ts on user-facing routes), fall back
//      to the Host header for /api/* routes (which the middleware
//      excludes), look up the canonical URL in URLS_BY_SLUG.
//   3. Outside any request lifecycle (cron, webhooks, build): fall
//      back to NEXT_PUBLIC_SITE_URL or the HPD canonical URL. Cron
//      callers iterating across tenants should call appBaseUrlForSlug
//      explicitly with each row's slug.

const URLS_BY_SLUG: Record<string, string> = {
  hpd: "https://app.housepartydistro.com",
  ihm: "https://app.inhousemerchandise.com",
};

function resolveSlugFromHost(host: string | null): string {
  if (!host) return "hpd";
  const h = host.toLowerCase().split(":")[0];
  if (h === "app.inhousemerchandise.com" || h === "ihm.localhost") return "ihm";
  return "hpd";
}

export async function appBaseUrl(): Promise<string> {
  if (typeof window !== "undefined") return window.location.origin;
  try {
    const { headers } = await import("next/headers");
    const h = await headers();
    const slug = h.get("x-company-slug") || resolveSlugFromHost(h.get("host"));
    if (URLS_BY_SLUG[slug]) return URLS_BY_SLUG[slug];
  } catch {
    // Outside a request — fall through.
  }
  return process.env.NEXT_PUBLIC_SITE_URL || URLS_BY_SLUG.hpd;
}

// Sync helper for cron / webhook callers that already know the tenant
// slug (e.g. resolved from a job/client/designer row's company_id).
export function appBaseUrlForSlug(slug: string): string {
  return URLS_BY_SLUG[slug] || URLS_BY_SLUG.hpd;
}

// Sync helper for client components — returns the current tenant origin
// in the browser. Empty string during SSR; links resolve correctly on
// hydration since the user is always on their tenant's domain.
export function appBaseUrlSync(): string {
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}
