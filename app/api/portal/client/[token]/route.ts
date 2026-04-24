import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
        "id, title, concept, state, deadline, client_intake_token, client_intake_submitted_at, purpose, audience, mood_words, no_gos, sent_to_designer_at, created_at, updated_at, client_aborted_at, job_id, jobs(title, job_number)"
      )
      .eq("client_id", client.id)
      .not("state", "in", "(delivered)")
      .is("client_aborted_at", null)
      .order("updated_at", { ascending: false });

    const briefList = (briefs || []) as any[];
    const ids = briefList.map(b => b.id);

    let filesByBrief: Record<string, any[]> = {};
    type Activity = { at: string; type: "message" | "upload" | "note"; kind?: string };
    let lastByRole: Record<string, { client?: Activity; designer?: Activity; hpd?: Activity }> = {};

    if (ids.length > 0) {
      const [filesRes, msgsRes] = await Promise.all([
        db.from("art_brief_files")
          .select("brief_id, drive_file_id, drive_link, kind, uploader_role, created_at, annotation_updated_at, client_annotation, designer_annotation, hpd_annotation")
          .in("brief_id", ids),
        db.from("art_brief_messages")
          .select("brief_id, sender_role, created_at"),
      ]);

      // Client sees everything except HPD's internal print-ready files.
      const visibleFiles = (filesRes.data || []).filter((f: any) => f.kind !== "print_ready");

      // Per-role last activity — group-chat "unread" uses this
      const bump = (bid: string, role: string | null | undefined, at: string, type: "message" | "upload" | "note", kind?: string) => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r];
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type, kind };
      };
      // Only count files visible to the client so "unread" matches reality.
      const lastTouched = (f: any) => {
        const c = f.created_at || "";
        const a = f.annotation_updated_at || "";
        return c > a ? c : a;
      };
      // Smart inference for annotation activity (single shared
      // annotation_updated_at column): if the role matches the file's
      // uploader, the annotation was set at upload (use created_at).
      // Otherwise it was PATCHed later (use shared). This prevents HPD's
      // PATCH time from being attributed to the designer's upload-time
      // note, which broke unread-badge math.
      for (const f of visibleFiles) {
        bump(f.brief_id, f.uploader_role, f.created_at, "upload", f.kind);
        const inferAt = (role: "hpd" | "designer" | "client", has: boolean) => {
          if (!has) return null;
          if (f.uploader_role === role) return f.created_at;
          return f.annotation_updated_at || null;
        };
        const hpdAt = inferAt("hpd", !!f.hpd_annotation);
        const designerAt = inferAt("designer", !!f.designer_annotation);
        const clientAt = inferAt("client", !!f.client_annotation);
        if (hpdAt) bump(f.brief_id, "hpd", hpdAt, "note", f.kind);
        if (designerAt) bump(f.brief_id, "designer", designerAt, "note", f.kind);
        if (clientAt) bump(f.brief_id, "client", clientAt, "note", f.kind);
      }
      for (const m of (msgsRes.data || [])) bump(m.brief_id, m.sender_role, m.created_at, "message");

      // Group visible files per brief, sorted by last touched (upload or note)
      visibleFiles.forEach((f: any) => {
        (filesByBrief[f.brief_id] ||= []).push(f);
      });
      Object.keys(filesByBrief).forEach(bid => {
        filesByBrief[bid].sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)));
      });
    }

    const KIND_LABEL: Record<string, string> = {
      final: "the Final", revision: "a Revision", first_draft: "a 1st Draft",
      wip: "a WIP", reference: "a reference", client_intake: "intake",
      print_ready: "Print-Ready",
    };

    const out = briefList.map(b => {
      const files = filesByBrief[b.id] || [];
      const thumbs = files.slice(0, 8).map(f => ({
        drive_file_id: f.drive_file_id,
        drive_link: f.drive_link,
        kind: f.kind,
      }));
      const intakeRequested = !!b.client_intake_token && !b.client_intake_submitted_at;
      const la = lastByRole[b.id] || {};
      const clientAt = la.client?.at || "";
      const designerAt = la.designer?.at || "";
      const hpdAt = la.hpd?.at || "";
      // Unread for client: someone else acted after the client did
      const lastExternal = designerAt > hpdAt ? designerAt : hpdAt;
      const lastExternalRole = designerAt > hpdAt ? "designer" : "hpd";
      const externalActivity = lastExternalRole === "designer" ? la.designer : la.hpd;
      const hasUnreadExternal = !!lastExternal && lastExternal > clientAt;
      // Preview line like "Designer uploaded Revision" or "HPD posted"
      let previewLine: string | null = null;
      if (hasUnreadExternal && externalActivity) {
        const who = lastExternalRole === "designer" ? "Designer" : "HPD";
        const label = KIND_LABEL[externalActivity.kind || ""] || "a file";
        if (externalActivity.type === "upload") {
          previewLine = `${who} uploaded ${label}`;
        } else if (externalActivity.type === "note") {
          previewLine = `${who} added a note on ${label}`;
        } else {
          previewLine = `${who} posted`;
        }
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
