// Single source of truth for tenant host→slug routing + per-tenant constants.
// Was duplicated inline in ~13 places (middleware, company, branding, email
// routes, public-url, …); each new tenant meant editing all of them. Add a
// tenant HERE only.
//
// Pure + dependency-free so it imports cleanly into Edge middleware, server
// components, API routes, and client components alike.

export const DEFAULT_SLUG = "hpd";

// Every host (apex + app subdomain + *.localhost dev) that maps to a tenant.
// Anything not listed falls back to DEFAULT_SLUG (HPD) — preserves the
// original single-tenant behavior for the Vercel preview URL + bare localhost.
const HOST_TO_SLUG: Record<string, string> = {
  "app.inhousemerchandise.com": "ihm",
  "inhousemerchandise.com": "ihm",
  "ihm.localhost": "ihm",
  "app.darkmatterdynamics.co": "dmd",
  "darkmatterdynamics.co": "dmd",
  "dmd.localhost": "dmd",
};

export function resolveSlugFromHost(host: string | null | undefined): string {
  if (!host) return DEFAULT_SLUG;
  const h = String(host).toLowerCase().split(":")[0];
  return HOST_TO_SLUG[h] || DEFAULT_SLUG;
}

// Canonical public origin per tenant (outgoing email links, portal URLs).
export const TENANT_URLS: Record<string, string> = {
  hpd: "https://app.housepartydistro.com",
  ihm: "https://app.inhousemerchandise.com",
  dmd: "https://app.darkmatterdynamics.co",
};

export function urlForSlug(slug: string): string {
  return TENANT_URLS[slug] || TENANT_URLS[DEFAULT_SLUG];
}

// Display-name fallback for client components before the companies row loads.
// The canonical name always comes from the companies table; this is only the
// pre-fetch placeholder.
export const TENANT_NAMES: Record<string, string> = {
  hpd: "House Party Distro",
  ihm: "In House Merchandise",
  dmd: "Dark Matter Dynamics",
};

export function nameForSlug(slug: string): string {
  return TENANT_NAMES[slug] || TENANT_NAMES[DEFAULT_SLUG];
}
