import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { attachUnreadStatus } from "@/lib/art-brief-activity";

export const dynamic = "force-dynamic";

// GET /api/dashboard/unread-count
//
// Returns { count } — how many external-driven items are awaiting an
// HPD response. Mirrors the conceptual filter used by the Designs
// portal's "has_unread_external" badge: external party (client, vendor,
// designer) made a move, OpsHub hasn't responded yet.
//
// Counted:
//   - quote_rejection_notes set on a job that hasn't been re-approved
//   - item_files with approval = "revision_requested" (client wants
//     proof changes)
//   - decorator_assignments.last_issue_at set + issue_resolved_at null
//     (vendor flagged an issue, HPD hasn't cleared it)
//   - art_briefs with has_unread_external = true (client / designer
//     posted/uploaded since HPD's last seen)
//
// Polled from AppShell on a short interval to drive the Dashboard
// nav badge.

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ count: 0 });

    const [quoteRej, proofRev, vendorDisc, briefs] = await Promise.all([
      supabase.from("jobs")
        .select("id", { count: "exact", head: true })
        .not("quote_rejection_notes", "is", null)
        .eq("quote_approved", false)
        .not("phase", "in", '("complete","cancelled")'),
      supabase.from("item_files")
        .select("id", { count: "exact", head: true })
        .eq("approval", "revision_requested")
        .is("superseded_at", null),
      supabase.from("decorator_assignments")
        .select("id", { count: "exact", head: true })
        .not("last_issue_at", "is", null)
        .is("issue_resolved_at", null),
      // Briefs need the activity merge — fetch ids + hpd_last_seen_at,
      // then run attachUnreadStatus to score them.
      supabase.from("art_briefs")
        .select("id, hpd_last_seen_at, state, client_aborted_at")
        .is("client_aborted_at", null)
        .neq("state", "delivered"),
    ]);

    let briefUnread = 0;
    if (briefs.data && briefs.data.length > 0) {
      const scored = await attachUnreadStatus(briefs.data as any[], supabase);
      briefUnread = scored.filter(b => b.has_unread_external).length;
    }

    const count = (quoteRej.count || 0) + (proofRev.count || 0) + (vendorDisc.count || 0) + briefUnread;
    return NextResponse.json({ count });
  } catch (e: any) {
    console.error("[unread-count]", e?.message || e);
    return NextResponse.json({ count: 0 });
  }
}
