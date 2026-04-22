import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

/**
 * Daily client digest — fires at 4pm PT (23:00 UTC).
 * Each client with active briefs gets a summary of the last 24h:
 * new drafts awaiting review, new notes from HPD/designer, upcoming deadlines.
 * Skipped entirely on zero-activity days — never more than once a day.
 */
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = admin();

  // Clients with a portal token AND at least one active brief
  const { data: clients } = await sb
    .from("clients")
    .select("id, name, portal_token")
    .not("portal_token", "is", null);

  if (!clients?.length) return NextResponse.json({ sent: 0, message: "No clients with portal" });

  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM_QUOTES || "hello@housepartydistro.com";
  const appBase = process.env.NEXT_PUBLIC_APP_URL || "https://opshub-umber.vercel.app";

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  let sent = 0;
  const errors: string[] = [];

  for (const c of clients as any[]) {
    // Fetch this client's primary contact (for email)
    const { data: contacts } = await sb
      .from("contacts")
      .select("email, name")
      .eq("client_id", c.id)
      .not("email", "is", null)
      .limit(5);

    const recipients = (contacts || []).map((x: any) => x.email).filter(Boolean);
    if (recipients.length === 0) continue;

    // Active briefs for this client
    const { data: briefs } = await sb
      .from("art_briefs")
      .select("id, title, state, deadline, updated_at")
      .eq("client_id", c.id)
      .is("client_aborted_at", null)
      .neq("state", "delivered");

    if (!briefs?.length) continue;

    const briefIds = briefs.map((b: any) => b.id);

    // Activity in the last 24h (files + note edits)
    const { data: recentFiles } = await sb
      .from("art_brief_files")
      .select("brief_id, kind, created_at, uploader_role, annotation_updated_at")
      .in("brief_id", briefIds)
      .or(`created_at.gte.${since},annotation_updated_at.gte.${since}`);

    const awaitingReview = briefs.filter((b: any) => b.state === "client_review");
    const approvedInPrep = briefs.filter((b: any) => ["final_approved", "pending_prep"].includes(b.state));
    const recentUploads = (recentFiles || []).filter((f: any) =>
      f.uploader_role !== "client" && f.kind !== "print_ready" && (f.created_at || "") >= since
    );
    const recentNotes = (recentFiles || []).filter((f: any) =>
      f.annotation_updated_at && f.annotation_updated_at >= since
    );

    const totalActivity = awaitingReview.length + recentUploads.length + recentNotes.length;
    if (totalActivity === 0) continue; // Skip — nothing new to report

    const portalUrl = `${appBase}/portal/client/${c.portal_token}`;

    const briefLine = (b: any) => {
      const due = b.deadline ? ` · due ${new Date(b.deadline).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : "";
      return `<li style="margin-bottom:6px;"><strong>${b.title || "Untitled design"}</strong><span style="color:#6b6b78">${due}</span></li>`;
    };

    const section = (label: string, items: any[], color: string) =>
      items.length === 0 ? "" : `
        <div style="margin:18px 0 10px 0;">
          <div style="font-size:11px;font-weight:700;color:${color};letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">${label} · ${items.length}</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;line-height:1.5;color:#1a1a1a;">${items.map(briefLine).join("")}</ul>
        </div>`;

    const activitySection = (recentUploads.length + recentNotes.length) === 0 ? "" : `
      <div style="margin:18px 0 10px 0;">
        <div style="font-size:11px;font-weight:700;color:#2d7a8f;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;">Latest activity · last 24h</div>
        <div style="font-size:13px;line-height:1.6;color:#1a1a1a;">
          ${recentUploads.length > 0 ? `<div>✏️ ${recentUploads.length} new file${recentUploads.length === 1 ? "" : "s"} from your design team</div>` : ""}
          ${recentNotes.length > 0 ? `<div>📝 ${recentNotes.length} new note${recentNotes.length === 1 ? "" : "s"} on your designs</div>` : ""}
        </div>
      </div>`;

    const html = `<!DOCTYPE html>
<html><body style="margin:0;padding:24px;background:#f8f8f9;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;color:#1a1a1a;">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:28px 32px;border:1px solid #e0e0e4;">
    <div style="font-size:10px;color:#6b6b78;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;">House Party Distro · Design Studio</div>
    <h1 style="font-size:22px;font-weight:800;margin:4px 0 6px 0;">Your ${c.name || "design"} update</h1>
    <p style="font-size:14px;color:#6b6b78;margin:0 0 8px 0;">${briefs.length} open design${briefs.length === 1 ? "" : "s"}.</p>
    ${section("Needs your review", awaitingReview, "#c43030")}
    ${activitySection}
    ${section("Approved · now in production prep", approvedInPrep, "#1a8c5c")}
    <div style="margin-top:24px;padding-top:18px;border-top:1px solid #e0e0e4;">
      <a href="${portalUrl}" style="display:inline-block;padding:10px 22px;background:#1a1a1a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:13px;">Open your portal →</a>
    </div>
    <div style="margin-top:18px;font-size:11px;color:#a0a0ad;">Daily update · we only send when there's something new to share. Reply to this email if you need us.</div>
  </div>
</body></html>`;

    try {
      await resend.emails.send({
        from,
        to: recipients,
        subject: `${c.name || "Your"} design update — ${briefs.length} open`,
        html,
      });
      sent++;
    } catch (e: any) {
      errors.push(`${c.name}: ${e.message}`);
    }
  }

  return NextResponse.json({ sent, errors });
}
