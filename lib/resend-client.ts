import { Resend } from "resend";

// Per-tenant Resend API keys. Each tenant has its own restricted key
// scoped to that tenant's verified sending domain — separates sender
// reputation, prevents one tenant's deliverability issues from
// affecting the other.
//
// Env vars:
//   RESEND_API_KEY_HPD — restricted to housepartydistro.com
//   RESEND_API_KEY_IHM — restricted to inhousemerchandise.com
//   RESEND_API_KEY     — legacy / fallback (used if a tenant-specific
//                        key isn't set, or for non-tenant contexts)
//
// Adding a new tenant: create a domain-restricted key in Resend, drop
// it into Vercel env as RESEND_API_KEY_<SLUG_UPPER>, and the picker
// will pick it up automatically.

function keyForSlug(slug: string | null | undefined): string {
  const upper = (slug || "hpd").toUpperCase();
  const tenantKey = process.env[`RESEND_API_KEY_${upper}`];
  if (tenantKey) return tenantKey;
  // Fall back to the legacy env var so single-tenant deployments and
  // any tenants without their own key still work.
  return process.env.RESEND_API_KEY || "";
}

export function resendForSlug(slug: string | null | undefined): Resend {
  return new Resend(keyForSlug(slug));
}

// Raw key string — for callers using fetch() directly against the
// Resend REST API instead of the SDK.
export function resendKeyForSlug(slug: string | null | undefined): string {
  return keyForSlug(slug);
}
