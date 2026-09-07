export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import crypto from "crypto";
import { resendForSlug } from "@/lib/resend-client";
import { renderBrandedEmail } from "@/lib/email-template";
import type { Database } from "@/types/database";

// POST /api/menu/gate — the email gate in front of the unlisted menu.
// { email, website } → { token }
//
// Captures the lead FIRST, then the page reveals the menu instantly —
// the email we send is the return key, never the door (deliverability
// must not sit between a warm lead and the menu). A returning email
// reuses its existing lead + token so picks survive. `website` is a
// honeypot (same trick as /api/contact).

const FROM_EMAIL = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

function admin() {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  let body: any;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const { email, website } = body || {};

  // Honeypot — pretend it worked so bots don't retry.
  if (typeof website === "string" && website.trim().length > 0) {
    return NextResponse.json({ ok: true, token: crypto.randomBytes(16).toString("hex") });
  }

  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 254) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const sb = admin();

  // Returning knocker: reuse the lead so their picks are waiting.
  const { data: existing } = await sb
    .from("menu_leads")
    .select("id,token")
    .eq("email", clean)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let token = existing?.token;
  if (!token) {
    token = crypto.randomBytes(16).toString("hex");

    // A gate email matching an existing client contact = friend of the
    // house; staff see the match and never quote rack rates blind.
    const { data: contact } = await sb
      .from("contacts")
      .select("client_id")
      .ilike("email", clean)
      .not("client_id", "is", null)
      .limit(1)
      .maybeSingle();

    const { error } = await sb.from("menu_leads").insert({
      token,
      email: clean,
      client_match: contact?.client_id ?? null,
    } as never);
    if (error) {
      console.error("menu gate insert failed", error);
      return NextResponse.json({ error: "Something went wrong. Try again." }, { status: 500 });
    }
  }

  // The return key. Send-and-forget — the reveal never waits on it.
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "housepartydistro.com";
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const link = `${proto}://${host}/menu/${token}`;
  try {
    await resendForSlug("hpd").emails.send({
      from: `House Party Distro <${FROM_EMAIL}>`,
      to: clean,
      subject: "Your House Party menu",
      html: renderBrandedEmail({
        heading: "You're in.",
        bodyHtml:
          "This is your personal link to the House Party menu. Real styles, real prices, no forms until you want a quote. It picks up right where you leave off.",
        cta: { label: "Open the menu", url: link },
        hint: "Questions? Just reply to this email.",
      }),
    });
  } catch (err) {
    console.error("menu gate email failed", err);
  }

  return NextResponse.json({ ok: true, token });
}
