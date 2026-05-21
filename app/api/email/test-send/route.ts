export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { resendForSlug } from "@/lib/resend-client";

// Fires a hardcoded test send through the exact same code path the
// real /api/email/send route uses (resendForSlug + Resend SDK). Returns
// the raw key prefix in use AND the full Resend response so we can see
// whether our path is hitting Resend differently than a direct curl.
export async function GET(req: NextRequest) {
  const host = (req.headers.get("host") || "").toLowerCase().split(":")[0];
  const slug = (host === "app.inhousemerchandise.com" || host === "ihm.localhost") ? "ihm" : "hpd";
  const upper = slug.toUpperCase();
  const tenantKey = process.env[`RESEND_API_KEY_${upper}`];
  const fallback = process.env.RESEND_API_KEY;
  const key = tenantKey || fallback || "";

  const resend = resendForSlug(slug);
  const payload = {
    from: "In House Merchandise <production@inhousemerchandise.com>",
    to: ["jon@housepartydistro.com"],
    subject: "test-send via SDK",
    html: "<p>via SDK through resendForSlug</p>",
  };

  const sdkResult: any = await resend.emails.send(payload).catch((e: any) => ({ thrown: String(e?.message || e) }));

  // Also send the same payload via raw fetch to compare — eliminates
  // any SDK quirks.
  let rawResult: any = null;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    rawResult = { status: r.status, body: await r.json() };
  } catch (e: any) {
    rawResult = { thrown: String(e?.message || e) };
  }

  return NextResponse.json({
    host,
    slug,
    using: tenantKey ? `RESEND_API_KEY_${upper}` : "RESEND_API_KEY (fallback)",
    keyPrefix: key ? key.slice(0, 12) + "…" : "(unset)",
    keyLength: key.length,
    sdkResult,
    rawResult,
  });
}
