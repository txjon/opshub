import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { computeFileOrdinals, formatActivityText, type ActivityRole, type ActivityType } from "@/lib/art-activity-text";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

// GET — designer dashboard: their info + all their assigned briefs
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const db = admin();
    const { data: designer } = await db.from("designers").select("id, name, active").eq("portal_token", params.token).single();
    if (!designer || !designer.active) return NextResponse.json({ error: "Invalid or inactive link" }, { status: 404 });

    // Update last_active timestamp (fire and forget)
    db.from("designers").update({ last_active_at: new Date().toISOString() }).eq("id", designer.id).then(() => {});

    // Load briefs assigned to this designer, only those that have been sent
    // No embedded join — fetch client names separately to avoid any PostgREST
    // cache weirdness around embedded resources.
    const { data: briefs, error: briefErr } = await db.from("art_briefs")
      .select("id, title, state, deadline, concept, placement, colors, mood_words, sent_to_designer_at, updated_at, version_count, job_id, item_id, client_id, client_aborted_at, archived_by")
      .eq("assigned_designer_id", designer.id)
      .not("sent_to_designer_at", "is", null)
      .order("updated_at", { ascending: false });

    if (briefErr) console.error("[design portal] brief query error:", briefErr);

    // Enrich with file counts + latest thumbnail per brief + client names
    // (clients fetched separately instead of embedded — embed silently returned
    // zero rows in the Next.js runtime even with service role).
    const briefIds = (briefs || []).map((b: any) => b.id);
    const clientIds = [...new Set((briefs || []).map((b: any) => b.client_id).filter(Boolean))];

    let filesByBrief: Record<string, any[]> = {};
    let clientsById: Record<string, { name: string }> = {};
    type Activity = { at: string; type: "message" | "upload" | "note"; kind?: string; fileId?: string; messageBody?: string };
    let lastByRole: Record<string, { client?: Activity; designer?: Activity; hpd?: Activity }> = {};
    // Per-file ordinal within its kind on each brief — drives the
    // "REF 3" / "2nd Draft" labeling in preview lines.
    let ordinalsByFileId: Record<string, number> = {};

    if (briefIds.length > 0) {
      const [filesResRaw, msgsRes, commentsRes] = await Promise.all([
        db.from("art_brief_files")
          .select("id, brief_id, kind, version, drive_file_id, drive_link, uploader_role, created_at, annotation_updated_at, client_annotation, designer_annotation, hpd_annotation")
          .in("brief_id", briefIds)
          .order("created_at", { ascending: false }),
        db.from("art_brief_messages")
          .select("brief_id, sender_role, created_at, message")
          .in("brief_id", briefIds),
        db.from("art_brief_file_comments")
          .select("brief_id, file_id, sender_role, created_at, body")
          .in("brief_id", briefIds),
      ]);
      // Designer doesn't see HPD's print_ready uploads — drop them from
      // the dashboard data so thumbs, activity, and previews all reflect
      // what the designer actually sees in the modal.
      const filesRes = { data: (filesResRaw.data || []).filter((f: any) => f.kind !== "print_ready") };
      for (const f of (filesRes.data || [])) {
        if (!filesByBrief[f.brief_id]) filesByBrief[f.brief_id] = [];
        filesByBrief[f.brief_id].push(f);
      }
      // Compute per-kind ordinal for every file across all briefs in one
      // pass. Each brief gets its own ordinal sequence per kind.
      for (const bid of briefIds) {
        const ord = computeFileOrdinals(filesByBrief[bid] || []);
        Object.assign(ordinalsByFileId, ord);
      }
      // Map fileId → kind for chat-comment activity attribution
      const fileKindById: Record<string, string> = {};
      for (const f of (filesRes.data || [])) fileKindById[f.id] = f.kind;
      // Compute last activity per role (uploads, chat comments, brief messages)
      const bump = (bid: string, role: string | null | undefined, at: string, type: "message" | "upload" | "note", extras: { kind?: string; fileId?: string; messageBody?: string } = {}) => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r];
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type, ...extras };
      };
      for (const f of (filesRes.data || [])) {
        bump(f.brief_id, f.uploader_role, f.created_at, "upload", { kind: f.kind, fileId: f.id });
      }
      // Per-file chat comments — definitive source for who-said-what-when.
      for (const c of (commentsRes.data || [])) {
        bump(c.brief_id, c.sender_role, c.created_at, "note", {
          kind: fileKindById[c.file_id] || undefined,
          fileId: c.file_id,
          messageBody: c.body,
        });
      }
      for (const m of (msgsRes.data || [])) bump(m.brief_id, m.sender_role, m.created_at, "message", { messageBody: m.message });
    }
    if (clientIds.length > 0) {
      const { data: clients } = await db.from("clients").select("id, name").in("id", clientIds);
      for (const c of (clients || [])) clientsById[c.id] = { name: c.name };
    }

    const lastTouched = (f: any) => {
      const c = f.created_at || "";
      const a = f.annotation_updated_at || "";
      return c > a ? c : a;
    };
    const enriched = (briefs || []).map((b: any) => {
      const files = filesByBrief[b.id] || [];
      // Tile thumb = most recently touched file (upload OR note edit)
      const sorted = [...files].sort((a: any, b: any) => lastTouched(b).localeCompare(lastTouched(a)));
      const latest = sorted[0] || null;
      // Mosaic of up to 4 most-recently-touched files, same pattern as
      // OpsHub Art Studio tiles.
      const thumbs = sorted.slice(0, 4).map((f: any) => ({
        drive_file_id: f.drive_file_id,
        drive_link: f.drive_link,
        kind: f.kind,
      }));
      const counts = { wip: 0, first_draft: 0, revision: 0, final: 0, reference: 0 };
      for (const f of files) {
        if (counts[f.kind as keyof typeof counts] !== undefined) counts[f.kind as keyof typeof counts]++;
      }
      const la = lastByRole[b.id] || {};
      const clientAt = la.client?.at || "";
      const designerAt = la.designer?.at || "";
      const hpdAt = la.hpd?.at || "";
      const latestExternal = clientAt > hpdAt ? clientAt : hpdAt;
      const latestExternalRole: "client" | "hpd" = clientAt > hpdAt ? "client" : "hpd";
      const latestExternalActivity = latestExternalRole === "client" ? la.client : la.hpd;
      const hasUnreadExternal = !!latestExternal && latestExternal > designerAt;
      const latestAt = [clientAt, designerAt, hpdAt].filter(Boolean).sort().pop() || b.updated_at || "";

      // Pre-compute the preview string server-side so the tile can render
      // it directly. Uses the shared formatter so wording matches across
      // designer / client / HPD surfaces ("HPD uploaded REF 3", etc.).
      //
      // Special case for designer: when state is "sent" and the designer
      // hasn't acted yet, the headline is "New design request" — the
      // request itself is the news. File uploads from HPD before the
      // designer's first action are part of the brief, not separate
      // events worth surfacing on the ribbon.
      let previewLine: string | null = null;
      if (hasUnreadExternal && latestExternalActivity) {
        if (b.state === "sent" && !designerAt) {
          previewLine = "New design request";
        } else {
          const fileId = (latestExternalActivity as any).fileId;
          previewLine = formatActivityText({
            role: latestExternalRole as ActivityRole,
            type: latestExternalActivity.type as ActivityType,
            kind: latestExternalActivity.kind || null,
            ordinal: fileId ? ordinalsByFileId[fileId] || null : null,
            messageBody: (latestExternalActivity as any).messageBody || null,
          });
        }
      }

      return {
        ...b,
        clients: b.client_id ? (clientsById[b.client_id] || null) : null,
        latest_thumb: latest ? { drive_file_id: latest.drive_file_id, drive_link: latest.drive_link, kind: latest.kind } : null,
        thumbs,
        thumb_total: files.length,
        file_counts: counts,
        last_client_activity: la.client || null,
        last_designer_activity: la.designer || null,
        last_hpd_activity: la.hpd || null,
        last_activity_at: latestAt,
        has_unread_external: hasUnreadExternal,
        unread_by_role: hasUnreadExternal ? latestExternalRole : null,
        unread_type: hasUnreadExternal ? latestExternalActivity?.type || null : null,
        unread_kind: hasUnreadExternal ? latestExternalActivity?.kind || null : null,
        preview_line: previewLine,
      };
    });

    // Sort briefs newest-activity-first across all roles (iMessage-style)
    enriched.sort((a: any, b: any) => (b.last_activity_at || "").localeCompare(a.last_activity_at || ""));

    return NextResponse.json({
      designer: { name: designer.name },
      briefs: enriched,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
