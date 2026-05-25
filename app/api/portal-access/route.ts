import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { resendForSlug } from "@/lib/resend-client";
import { headers } from "next/headers";

// POST /api/portal-access
//
// Public endpoint that powers the /client-portal email form. Takes
// an email, looks up matching client(s) via the contacts table, and
// emails the portal magic-link to each match.
//
// Privacy: we always respond 200 OK regardless of whether the email
// matched anything — never leak which emails are clients. The caller
// just sees "If you have an active account, we just sent you a link."

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawEmail = (body?.email || "").toString().trim().toLowerCase();
    if (!rawEmail || !rawEmail.includes("@")) {
      return NextResponse.json({ ok: true });
    }

    const db = admin();

    // Find every client whose contact roster includes this email AND
    // who has portal access enabled (portal_token is not null).
    const { data: contacts } = await db
      .from("contacts")
      .select("client_id, email, clients(id, name, portal_token)")
      .ilike("email", rawEmail);

    const matches = (contacts || [])
      .map((c: any) => c.clients)
      .filter((cl: any) => cl && cl.portal_token);

    if (matches.length === 0) {
      // Don't reveal — silent success.
      return NextResponse.json({ ok: true });
    }

    // Resolve the tenant slug from the request host so the email is
    // sent via the right Resend key + uses the right from-address.
    const h = await headers();
    const slug = h.get("x-company-slug") || "hpd";
    const resend = resendForSlug(slug);

    // Build the base URL for portal links. Prefer the configured
    // public URL, fall back to the request origin.
    const origin = (() => {
      const proto = h.get("x-forwarded-proto") || "https";
      const host = h.get("host") || "housepartydistro.com";
      return `${proto}://${host}`;
    })();

    // De-dupe by client_id so a client with multiple matching contacts
    // only gets one email.
    const uniq = new Map<string, { id: string; name: string; portal_token: string }>();
    for (const m of matches) uniq.set(m.id, m);
    const finalMatches = Array.from(uniq.values());

    // Build a single email listing all matched portals — cleaner than
    // multiple emails when one person is on multiple client accounts.
    const fromAddress = slug === "ihm"
      ? "In House Merchandise <hello@inhousemerchandise.com>"
      : "House Party Distro <hello@housepartydistro.com>";

    const subject = finalMatches.length === 1
      ? `Your ${finalMatches[0].name} portal access`
      : `Your portal access (${finalMatches.length} accounts)`;

    const links = finalMatches.map(m => {
      const url = `${origin}/portal/client/${m.portal_token}`;
      return `<p style="margin:8px 0;"><strong>${escapeHtml(m.name)}</strong><br/><a href="${url}" style="color:#1a1a1a;">${url}</a></p>`;
    }).join("");

    await resend.emails.send({
      from: fromAddress,
      to: rawEmail,
      subject,
      html: `
        <div style="font-family: Inter, -apple-system, sans-serif; max-width: 540px; margin: 0 auto; padding: 24px; color: #1a1a1a;">
          <h2 style="font-size: 18px; font-weight: 800; margin-bottom: 16px;">Your portal access</h2>
          <p style="font-size: 14px; line-height: 1.6; color: #4a4a55; margin-bottom: 16px;">
            Click below to view your projects, approve quotes &amp; proofs, and pay invoices.
          </p>
          ${links}
          <p style="font-size: 12px; color: #a0a0ad; margin-top: 24px; line-height: 1.5;">
            If you didn&rsquo;t request this email, you can safely ignore it. The link will keep working as long as the account is active.
          </p>
        </div>
      `,
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    // Even on internal error we don't surface details — return ok.
    // The /client-portal page shows a generic confirmation regardless.
    console.error("[portal-access]", e?.message || e);
    return NextResponse.json({ ok: true });
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
