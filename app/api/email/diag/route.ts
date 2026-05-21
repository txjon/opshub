export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// Tiny diagnostic that returns what /api/email/send would resolve for
// the current request — host, slug, which env var the resend picker
// would use, and a key prefix so we can confirm Vercel env is wired.
// Safe to keep around: only returns the first 12 chars of the key
// (Resend tokens are ~32 chars; the prefix isn't enough to send with).
export async function GET(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  const slug = (host === "app.inhousemerchandise.com" || host === "ihm.localhost") ? "ihm" : "hpd";
  const upper = slug.toUpperCase();
  const tenantKey = process.env[`RESEND_API_KEY_${upper}`];
  const fallback = process.env.RESEND_API_KEY;
  const using = tenantKey ? `RESEND_API_KEY_${upper}` : "RESEND_API_KEY (fallback)";
  const key = tenantKey || fallback || "";
  return NextResponse.json({
    host,
    slug,
    using,
    keyPrefix: key ? key.slice(0, 12) + "…" : "(unset)",
    tenantKeySet: !!tenantKey,
    fallbackSet: !!fallback,
  });
}
