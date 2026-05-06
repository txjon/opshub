import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { appBaseUrlForSlug } from "@/lib/public-url";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * Daily designer digest — fires at 8am PT (15:00 UTC).
 * Sends each active designer with an email address a summary of their queue:
 * what's awaiting their upload, what's with client, what's in HPD prep.
 * Skips designers with zero active briefs to avoid empty-inbox spam.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = admin();

  // Pull company slug too so each designer's digest links use that
  // tenant's subdomain (HPD vs IHM, etc.).
  const { data: designers } = await sb
    .from("designers")
    .select("id, name, email, portal_token, companies:company_id(slug)")
    .eq("active", true)
    .not("email", "is", null);

  if (!designers?.length) {
    return NextResponse.json({ sent: 0, message: "No active designers" });
  }

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";

  let sent = 0;
  const errors: string[] = [];

  for (const d of designers as any[]) {
    if (!d.email || !d.portal_token) continue;

    const { data: briefs } = await sb
      .from("art_briefs")
      .select("id, title, state, deadline, clients(name)")
      .eq("assigned_designer_id", d.id)
      .not("sent_to_designer_at", "is", null)
      .is("client_aborted_at", null)
      .neq("state", "delivered");

    if (!briefs?.length) continue; // Skip empty digests — no spam

    // Split by whose move it is
    const yourMove = briefs.filter((b: any) => ["sent", "in_progress", "revisions"].includes(b.state));
    const withClient = briefs.filter((b: any) => b.state === "client_review");
    const inPrep = briefs.filter((b: any) => ["pending_prep", "final_approved", "production_ready"].includes(b.state));

    const portalUrl = `${appBaseUrlForSlug(d.companies?.slug)}/design/${d.portal_token}`;

    const rowHtml = (b: any) => {
      const clientName = (b.clients as any)?.name || "Client";
      const due = b.deadline ? ` · due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
      return `<li style="margin-bottom:6px;"><strong>${b.title || "Untitled"}</strong> <span style="color:#6b6b78">· ${clientName}${due}</span></li>`;
    };

    const section = (label: string, items: any[], color: string) =>
      items.length === 0 ? "" : `
        <div style="margin:18px 0 10px 0;">
          <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${label} · ${items.length}</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#1a1a1a;">${items.map(rowHtml).join("")}</ul>
        </div>`;

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f8f8f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e0e0e4;">
    <div style="font-size:10px;color:#6b6b78;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">House Party Distro</div>
    <h1 style="font-size:22px;font-weight:800;margin:4px 0 6px 0;">Good morning, ${d.name || "team"}.</h1>
    <p style="font-size:14px;color:#6b6b78;margin:0 0 8px 0;">${briefs.length} open brief${briefs.length === 1 ? "" : "s"} on your plate today.</p>
    ${section("Your move", yourMove, "#c43030")}
    ${section("With client", withClient, "#7c3aed")}
    ${section("With HPD (production prep)", inPrep, "#1a8c5c")}
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e0e0e4;">
      <a href="${portalUrl}" style="display:inline-block;padding:10px 22px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;">Open your portal →</a>
    </div>
    <div style="margin-top:18px;font-size:11px;color:#a0a0ad;">Daily digest · sent when there's work to look at. Reply to this email if you need HPD.</div>
  </div>
</body></html>`;

    try {
      await resend.emails.send({
        from,
        to: d.email,
        subject: `Design queue — ${briefs.length} open`,
        html,
      });
      sent++;
    } catch (e: any) {
      errors.push(`${d.name}: ${e.message}`);
    }
  }

  return NextResponse.json({ sent, errors });
}
