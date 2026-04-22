// Canonical public URL for outgoing emails and any links clients/vendors see.
//
// Prefers the explicit env var; falls back to the branded custom domain
// (app.housepartydistro.com). Deliberately does NOT consult VERCEL_URL —
// that resolves to per-deployment preview URLs which are unstable and look
// junk in an email recipient's inbox.
//
// Set NEXT_PUBLIC_SITE_URL=https://app.housepartydistro.com in Vercel env
// to override (useful for staging / previews that want their own URL).

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "https://app.housepartydistro.com"
  );
}
