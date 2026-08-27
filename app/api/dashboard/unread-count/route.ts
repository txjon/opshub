import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attachUnreadStatus } from "@/lib/art-brief-activity";

export const dynamic = "force-dynamic";

// GET /api/dashboard/unread-count
//
// Strict messenger model: returns count of NEW external-driven events
// since the team last opened /dashboard. The "last seen" timestamp
// lives team-wide on companies.branding.last_dashboard_seen_at and is
// bumped by /api/dashboard/seen on dashboard mount.
//
// Each source filters by its own existing event timestamp:
//   - jobs.updated_at         → quote rejections (noisy: job edits
//     also bump this; the card itself stays visible until resolved
//     so the slight badge noise is acceptable for v1)
//   - item_files.created_at   → proof revisions
//   - decorator_assignments.last_issue_at → vendor flags
//   - art_briefs unread_at    → unread external activity on briefs
//
// First visit (no timestamp saved) → treat as Unix epoch → all
// existing items count once, after which they clear on dashboard open.

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ count: 0 });

    const { data: companies } = await supabase.from("companies").select("branding").limit(1);
    const branding = ((companies || [])[0] as any)?.branding || {};
    const lastSeen = branding.last_dashboard_seen_at || "1970-01-01T00:00:00.000Z";
    const overrides: string[] = Array.isArray(branding.dashboard_unread_overrides)
      ? branding.dashboard_unread_overrides : [];

    const [quoteRej, proofRev, vendorDisc, briefs] = await Promise.all([
      supabase.from("jobs")
        .select("id", { count: "exact", head: true })
        .not("quote_rejection_notes", "is", null)
        .eq("quote_approved", false)
        .not("phase", "in", '("complete","cancelled")')
        .gt("updated_at", lastSeen),
      supabase.from("item_files")
        .select("id", { count: "exact", head: true })
        .eq("approval", "revision_requested")
        .is("superseded_at", null)
        .gt("created_at", lastSeen),
      supabase.from("decorator_assignments")
        .select("id", { count: "exact", head: true })
        .not("last_issue_at", "is", null)
        .is("issue_resolved_at", null)
        .gt("last_issue_at", lastSeen),
      // Briefs need the activity merge — fetch ids + hpd_last_seen_at,
      // then run attachUnreadStatus to score them.
      supabase.from("art_briefs")
        .select("id, hpd_last_seen_at, state, client_aborted_at")
        .is("client_aborted_at", null).is("deleted_at", null)
        .neq("state", "killed"),
    ]);

    let briefUnread = 0;
    if (briefs.data && briefs.data.length > 0) {
      const scored = await attachUnreadStatus(briefs.data as any[], supabase);
      briefUnread = scored.filter(b =>
        b.has_unread_external && b.unread_at && b.unread_at > lastSeen
      ).length;
    }

    const eventCount = (quoteRej.count || 0) + (proofRev.count || 0) + (vendorDisc.count || 0) + briefUnread;
    // Manual overrides — cards Jon (or anyone) explicitly flagged as
    // unread to ping Drake / Taylor. These persist independent of
    // last_seen_at until explicitly marked read.
    const overrideCount = overrides.length;
    const count = eventCount + overrideCount;
    return NextResponse.json({ count });
  } catch (e: any) {
    console.error("[unread-count]", e?.message || e);
    return NextResponse.json({ count: 0 });
  }
}
