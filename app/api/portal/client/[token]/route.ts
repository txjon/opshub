import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { computeFileOrdinals, formatActivityText, type ActivityRole, type ActivityType } from "@/lib/art-activity-text";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET /api/portal/client/[token]
// Returns all art briefs for the client identified by the portal token,
// plus per-brief intake tokens so the front-end can deep-link to
// /art-intake/[token] for each one.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: client } = await db
      .from("clients")
      .select("id, name")
      .eq("portal_token", params.token)
      .single();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

    const { data: briefs } = await db
      .from("art_briefs")
      .select(
        "id, title, concept, state, deadline, client_intake_token, client_intake_submitted_at, purpose, audience, mood_words, no_gos, sent_to_designer_at, created_at, updated_at, client_aborted_at, job_id, client_last_seen_at, jobs(title, job_number)"
      )
      .eq("client_id", client.id)
      .not("state", "in", "(delivered)")
      .is("client_aborted_at", null)
      .order("updated_at", { ascending: false });

    const briefList = (briefs || []) as any[];
    const ids = briefList.map(b => b.id);

    let filesByBrief: Record<string, any[]> = {};
    type Activity = { at: string; type: "message" | "upload" | "note"; kind?: string; fileId?: string; messageBody?: string };
    let lastByRole: Record<string, { client?: Activity; designer?: Activity; hpd?: Activity }> = {};
    // Per-file ordinal within its kind on each brief — drives the
    // "REF 3" / "2nd Draft" labeling in preview lines.
    let ordinalsByFileId: Record<string, number> = {};

    if (ids.length > 0) {
      const [filesRes, msgsRes, commentsRes] = await Promise.all([
        db.from("art_brief_files")
          .select("id, brief_id, drive_file_id, preview_drive_file_id, drive_link, kind, uploader_role, created_at, annotation_updated_at, client_annotation, designer_annotation, hpd_annotation, shared_with_client_at")
          .in("brief_id", ids),
        db.from("art_brief_messages")
          .select("brief_id, sender_role, created_at, message"),
        db.from("art_brief_file_comments")
          .select("brief_id, file_id, sender_role, created_at, body")
          .in("brief_id", ids),
      ]);

      // Client visibility rules:
      // - print_ready hidden — HPD's internal CMYK/separations file
      // - wip hidden — designer↔HPD working files, unless HPD has explicitly
      //   surfaced one via shared_with_client_at (future "share WIP" toggle)
      const visibleFiles = (filesRes.data || []).filter((f: any) => {
        if (f.kind === "print_ready") return false;
        if (f.kind === "wip" && !f.shared_with_client_at) return false;
        return true;
      });
      const visibleFileIds = new Set(visibleFiles.map((f: any) => f.id));
      const fileKindById: Record<string, string> = {};
      for (const f of visibleFiles) fileKindById[f.id] = f.kind;

      // Per-role last activity — group-chat "unread" uses this
      const bump = (bid: string, role: string | null | undefined, at: string, type: "message" | "upload" | "note", extras: { kind?: string; fileId?: string; messageBody?: string } = {}) => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r];
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type, ...extras };
      };
      // Bump per upload (visible files only so "unread" matches reality).
      // For WIPs that were forwarded later, use shared_with_client_at —
      // the file's "first visible to client" moment is the share, not the
      // original upload (which can be days older than client_last_seen_at
      // and would otherwise miss the unread check).
      for (const f of visibleFiles) {
        const at = (f.kind === "wip" && f.shared_with_client_at) ? f.shared_with_client_at : f.created_at;
        bump(f.brief_id, f.uploader_role, at, "upload", { kind: f.kind, fileId: f.id });
      }
      // Per-file chat comments — only those on files the client can see
      for (const c of (commentsRes.data || [])) {
        if (!visibleFileIds.has(c.file_id)) continue;
        bump(c.brief_id, c.sender_role, c.created_at, "note", {
          kind: fileKindById[c.file_id] || undefined,
          fileId: c.file_id,
          messageBody: c.body,
        });
      }
      for (const m of (msgsRes.data || [])) bump(m.brief_id, m.sender_role, m.created_at, "message", { messageBody: m.message });

      // Group visible files per brief, newest-touched at top (upload time).
      visibleFiles.forEach((f: any) => {
        (filesByBrief[f.brief_id] ||= []).push(f);
      });
      Object.keys(filesByBrief).forEach(bid => {
        filesByBrief[bid].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
      });

      // Compute per-kind ordinal for every visible file so previews can
      // label them as REF 3 / 2nd Draft / etc.
      for (const bid of ids) {
        const ord = computeFileOrdinals(filesByBrief[bid] || []);
        Object.assign(ordinalsByFileId, ord);
      }
    }

    const out = briefList.map(b => {
      const files = filesByBrief[b.id] || [];
      const thumbs = files.slice(0, 8).map(f => ({
        drive_file_id: f.drive_file_id,
        preview_drive_file_id: f.preview_drive_file_id || null,
        drive_link: f.drive_link,
        kind: f.kind,
      }));
      // Tile-level action-banner needs to know whether this brief has a
      // formal draft to approve (vs a forwarded WIP that's just a
      // direction check). Keeps banner copy honest at client_review.
      const hasLatestDraft = files.some((f: any) => f.kind === "first_draft" || f.kind === "revision");
      const intakeRequested = !!b.client_intake_token && !b.client_intake_submitted_at;
      const la = lastByRole[b.id] || {};
      // clientAt = max(actual client activity, client_last_seen_at).
      // Opening the modal counts as "seen" — clears the unread ribbon
      // even if the client didn't post anything.
      const clientActivityAt = la.client?.at || "";
      const clientSeenAt = (b as any).client_last_seen_at || "";
      const clientAt = clientActivityAt > clientSeenAt ? clientActivityAt : clientSeenAt;
      const designerAt = la.designer?.at || "";
      const hpdAt = la.hpd?.at || "";
      // Unread for client: someone else acted after the client did/saw
      const lastExternal = designerAt > hpdAt ? designerAt : hpdAt;
      const lastExternalRole = designerAt > hpdAt ? "designer" : "hpd";
      const externalActivity = lastExternalRole === "designer" ? la.designer : la.hpd;
      const hasUnreadExternal = !!lastExternal && lastExternal > clientAt;
      // Preview line — uses the shared formatter so wording matches what
      // the designer + HPD see on the same brief ("HPD uploaded REF 3",
      // "Designer uploaded 2nd Draft", etc.).
      let previewLine: string | null = null;
      if (hasUnreadExternal && externalActivity) {
        const fileId = (externalActivity as any).fileId;
        previewLine = formatActivityText({
          role: lastExternalRole as ActivityRole,
          type: externalActivity.type as ActivityType,
          kind: externalActivity.kind || null,
          ordinal: fileId ? ordinalsByFileId[fileId] || null : null,
          messageBody: (externalActivity as any).messageBody || null,
        });
      }
      // Sort timestamp — "latest activity by anyone", newest to top
      const latestAt = [clientAt, designerAt, hpdAt].filter(Boolean).sort().pop() || b.updated_at || b.created_at;
      return {
        id: b.id,
        title: b.title || null,
        concept: b.concept || null,
        state: b.state,
        deadline: b.deadline,
        job_title: b.jobs?.title || null,
        job_number: b.jobs?.job_number || null,
        intake_token: b.client_intake_token || null,
        intake_requested: intakeRequested,
        submitted_at: b.client_intake_submitted_at,
        has_intake: !!b.client_intake_submitted_at,
        sent_to_designer_at: b.sent_to_designer_at,
        thumbs,
        thumb_total: files.length,
        updated_at: b.updated_at,
        last_activity_at: latestAt,
        has_unread_external: hasUnreadExternal,
        has_latest_draft: hasLatestDraft,
        unread_kind: hasUnreadExternal ? externalActivity?.kind || null : null,
        preview_line: previewLine,
      };
    });

    // Sort briefs by latest activity across all roles, newest first — iMessage style
    out.sort((a, b) => (b.last_activity_at || "").localeCompare(a.last_activity_at || ""));

    // Lightweight orders summary — drives the Overview tab's stat strip.
    // Full order details come from /api/portal/client/[token]/orders.
    // Statuses map: intake/pending/ready/production → "In Production",
    // receiving/fulfillment → "Shipping", complete → "Delivered", on_hold → "Paused".
    // Cancelled hidden.
    const deliveredCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    const { data: jobs } = await db
      .from("jobs")
      .select("id, phase, target_ship_date, updated_at")
      .eq("client_id", client.id)
      .not("phase", "in", "(cancelled)");
    const activeJobs = (jobs || []).filter((j: any) => j.phase !== "complete");
    const deliveredRecent = (jobs || []).filter((j: any) =>
      j.phase === "complete" && (j.updated_at || "") >= deliveredCutoff
    );
    const nextShipJob = activeJobs
      .filter((j: any) => j.target_ship_date)
      .sort((a: any, b: any) => (a.target_ship_date || "").localeCompare(b.target_ship_date || ""))[0];

    // Unpaid count must match what the Orders tab marks as "Unpaid" —
    // i.e., has an invoice (payment_records row issued OR qb_invoice_number
    // set in type_meta) AND balance > 0 after applied payments. Earlier
    // version only checked payment_records statuses, missing jobs that
    // have a QB invoice pushed but no OpsHub payment row yet.
    // Scope: every non-cancelled job for the client (not just active) so a
    // completed-but-unpaid job still shows up as owed.
    const { data: scopeJobs } = await db
      .from("jobs")
      .select("id, type_meta, costing_summary")
      .eq("client_id", client.id)
      .not("phase", "in", "(cancelled)");
    const scopeJobIds = (scopeJobs || []).map((j: any) => j.id);

    let unpaidCount = 0;
    if (scopeJobIds.length > 0) {
      const { data: pays } = await db
        .from("payment_records")
        .select("job_id, status, amount")
        .in("job_id", scopeJobIds);
      const paysByJob = new Map<string, any[]>();
      for (const p of pays || []) {
        const arr = paysByJob.get(p.job_id) || [];
        arr.push(p);
        paysByJob.set(p.job_id, arr);
      }
      for (const j of scopeJobs || []) {
        const typeMeta = (j.type_meta || {}) as any;
        const costingSummary = (j.costing_summary || {}) as any;
        const jobPays = paysByJob.get(j.id) || [];
        const hasIssued = jobPays.some((p: any) => p.status && !["draft", "void"].includes(p.status));
        const typeMetaHasQB = !!typeMeta.qb_invoice_number;
        const isInvoiced = hasIssued || typeMetaHasQB;
        if (!isInvoiced) continue;
        // Total — prefer QB total_with_tax, fall back to costing grossRev.
        const total = Number(typeMeta.qb_total_with_tax) || Number(costingSummary.grossRev) || 0;
        const paidAmount = jobPays.filter((p: any) => p.status === "paid").reduce((a: number, p: any) => a + (Number(p.amount) || 0), 0);
        const balance = total - paidAmount;
        if (balance > 0.01) unpaidCount++;
      }
    }

    // Fold in ShipStation fulfillment invoices — same rule as Orders tab:
    // has any invoice number (pushed or manually entered) AND not yet paid.
    const { data: shipReports } = await db
      .from("shipstation_reports")
      .select("id, paid_at")
      .eq("client_id", client.id)
      .not("qb_invoice_number", "is", null);
    unpaidCount += (shipReports || []).filter((r: any) => !r.paid_at).length;

    return NextResponse.json({
      client: { name: client.name },
      briefs: out,
      orders_summary: {
        active_count: activeJobs.length,
        delivered_recent_count: deliveredRecent.length,
        unpaid_count: unpaidCount,
        next_ship_date: nextShipJob?.target_ship_date || null,
      },
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
