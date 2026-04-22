import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";

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
    let lastByRole: Record<string, { client?: { at: string; type: "file" | "message" }; designer?: { at: string; type: "file" | "message" }; hpd?: { at: string; type: "file" | "message" } }> = {};

    if (briefIds.length > 0) {
      const [filesRes, msgsRes] = await Promise.all([
        db.from("art_brief_files")
          .select("brief_id, kind, version, drive_file_id, drive_link, uploader_role, created_at, annotation_updated_at, client_annotation, designer_annotation, hpd_annotation")
          .in("brief_id", briefIds)
          .order("created_at", { ascending: false }),
        db.from("art_brief_messages")
          .select("brief_id, sender_role, created_at")
          .in("brief_id", briefIds),
      ]);
      for (const f of (filesRes.data || [])) {
        if (!filesByBrief[f.brief_id]) filesByBrief[f.brief_id] = [];
        filesByBrief[f.brief_id].push(f);
      }
      // Compute last activity per role (file uploads + thread messages)
      const bump = (bid: string, role: string | null | undefined, at: string, type: "file" | "message") => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r];
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type };
      };
      for (const f of (filesRes.data || [])) {
        bump(f.brief_id, f.uploader_role, f.created_at, "file");
        if (f.annotation_updated_at) {
          if (f.hpd_annotation) bump(f.brief_id, "hpd", f.annotation_updated_at, "file");
          if (f.designer_annotation) bump(f.brief_id, "designer", f.annotation_updated_at, "file");
          if (f.client_annotation) bump(f.brief_id, "client", f.annotation_updated_at, "file");
        }
      }
      for (const m of (msgsRes.data || [])) bump(m.brief_id, m.sender_role, m.created_at, "message");
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
      // Designer-facing "new for you" flag: client OR HPD acted more
      // recently than designer. Mirrors iMessage unread semantics.
      const clientAt = la.client?.at || "";
      const designerAt = la.designer?.at || "";
      const hpdAt = la.hpd?.at || "";
      const latestExternal = clientAt > hpdAt ? clientAt : hpdAt;
      const latestExternalRole: "client" | "hpd" = clientAt > hpdAt ? "client" : "hpd";
      const latestExternalActivity = latestExternalRole === "client" ? la.client : la.hpd;
      const hasUnreadExternal = !!latestExternal && latestExternal > designerAt;
      // Latest of anyone — used to sort newest-first
      const latestAt = [clientAt, designerAt, hpdAt].filter(Boolean).sort().pop() || b.updated_at || "";
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
