import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { computeFileOrdinals, formatActivityText, type ActivityRole, type ActivityType } from "@/lib/art-activity-text";

// GET /api/art-briefs?itemId=xxx — list briefs for an item (with files and messages)
// GET /api/art-briefs?jobId=xxx — list briefs for a job
// GET /api/art-briefs?id=xxx — single brief with files + messages
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const itemId = req.nextUrl.searchParams.get("itemId");
    const jobId = req.nextUrl.searchParams.get("jobId");
    const clientId = req.nextUrl.searchParams.get("clientId");
    const id = req.nextUrl.searchParams.get("id");
    const all = req.nextUrl.searchParams.get("all");

    // Note on the items embed: migration 029 added items.design_id → art_briefs(id),
    // creating a second FK between the two tables. Without the !fkey hint PostgREST
    // throws PGRST201 (ambiguous embed). We want the legacy 1:1 "this brief is for
    // this item" relationship, so force the item_id FK explicitly.
    const ITEMS_EMBED = "items!art_briefs_item_id_fkey(name)";

    if (id) {
      const [briefRes, filesRes, msgsRes] = await Promise.all([
        supabase.from("art_briefs").select(`*, ${ITEMS_EMBED}, jobs(title, job_number), clients(name)`).eq("id", id).single(),
        supabase.from("art_brief_files").select("*").eq("brief_id", id).order("created_at"),
        supabase.from("art_brief_messages").select("*").eq("brief_id", id).order("created_at"),
      ]);
      // Mark-as-read for HPD on every detail open. Fire-and-forget so
      // the GET stays fast. Listing rollup factors this timestamp into
      // hpdAt, so unread ribbons clear once HPD has glanced at the brief.
      supabase.from("art_briefs").update({ hpd_last_seen_at: new Date().toISOString() }).eq("id", id).then(() => {});
      if (briefRes.error) return NextResponse.json({ error: briefRes.error.message }, { status: 404 });
      // Per-kind 1-based ordinal so the file badge can render "REF 3" /
      // "2nd Draft" instead of just "REF" / "REV".
      const ordinals = computeFileOrdinals(filesRes.data || []);
      // Per-file chat comments — needed by ArtReferencesGrid for the
      // chat thread on each file card.
      const fileIds = (filesRes.data || []).map((f: any) => f.id);
      const { data: commentsRaw } = fileIds.length > 0
        ? await supabase.from("art_brief_file_comments")
            .select("id, file_id, sender_role, body, created_at")
            .in("file_id", fileIds)
            .order("created_at")
        : { data: [] as any[] };
      const commentsByFile: Record<string, any[]> = {};
      for (const c of (commentsRaw || [])) (commentsByFile[c.file_id] ||= []).push(c);
      const filesWithOrd = (filesRes.data || []).map((f: any) => ({
        ...f,
        kind_ordinal: ordinals[f.id] || null,
        comments: commentsByFile[f.id] || [],
      }));
      return NextResponse.json({
        brief: briefRes.data,
        files: filesWithOrd,
        messages: msgsRes.data || [],
      });
    }

    // Hide aborted briefs older than the 60-day repurpose window — HPD can
    // still access fresh abortions for reuse.
    const abortCutoff = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    let query = supabase.from("art_briefs")
      .select(`*, ${ITEMS_EMBED}, jobs(title, job_number, job_type), clients(name)`)
      .or(`client_aborted_at.is.null,client_aborted_at.gte.${abortCutoff}`)
      .order("created_at", { ascending: false });
    if (itemId) query = query.eq("item_id", itemId);
    if (jobId) query = query.eq("job_id", jobId);
    if (clientId) query = query.eq("client_id", clientId);

    const { data, error } = await query;
    if (error) {
      console.error("[art-briefs GET] query error:", error);
      return NextResponse.json({ error: error.message, code: error.code, hint: error.hint }, { status: 500 });
    }

    console.log(`[art-briefs GET] user=${user.id.slice(0,8)} returned ${data?.length || 0} briefs`);

    // Attach message counts, best thumbnail, and last-activity-per-role.
    // last_*_activity tells downstream UIs "who's been radio silent" so we can
    // flag unread client activity on HPD/designer tiles.
    const briefs = data || [];
    if (briefs.length > 0) {
      const ids = briefs.map((b: any) => b.id);
      const [msgsRes, filesRes, commentsRes] = await Promise.all([
        supabase.from("art_brief_messages").select("brief_id, sender_role, created_at, message").in("brief_id", ids),
        supabase.from("art_brief_files").select("id, brief_id, drive_file_id, drive_link, kind, uploader_role, created_at").in("brief_id", ids).order("created_at", { ascending: false }),
        supabase.from("art_brief_file_comments").select("brief_id, file_id, sender_role, body, created_at").in("brief_id", ids),
      ]);

      // Message counts
      const counts: Record<string, { total: number; designer: number }> = {};
      (msgsRes.data || []).forEach((m: any) => {
        const c = counts[m.brief_id] ||= { total: 0, designer: 0 };
        c.total++;
        if (m.sender_role === "designer") c.designer++;
      });

      // Last activity per role — type distinguishes upload / note / message
      // so downstream can render specific preview strings.
      type Activity = { at: string; type: "message" | "upload" | "note"; kind?: string; fileId?: string; messageBody?: string };
      const lastByRole: Record<string, { client?: Activity; designer?: Activity; hpd?: Activity }> = {};
      const bump = (bid: string, role: string | null | undefined, at: string, type: "message" | "upload" | "note", extras: { kind?: string; fileId?: string; messageBody?: string } = {}) => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r] as Activity | undefined;
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type, ...extras };
      };
      // Per-brief file ordinals (so preview lines say "REF 3", "2nd Draft")
      const filesByBrief: Record<string, any[]> = {};
      const fileKindById: Record<string, string> = {};
      (filesRes.data || []).forEach((f: any) => {
        (filesByBrief[f.brief_id] ||= []).push(f);
        fileKindById[f.id] = f.kind;
      });
      const ordinalsByFileId: Record<string, number> = {};
      Object.keys(filesByBrief).forEach(bid => {
        Object.assign(ordinalsByFileId, computeFileOrdinals(filesByBrief[bid] || []));
      });

      (msgsRes.data || []).forEach((m: any) => bump(m.brief_id, m.sender_role, m.created_at, "message", { messageBody: m.message }));
      (filesRes.data || []).forEach((f: any) => {
        bump(f.brief_id, f.uploader_role, f.created_at, "upload", { kind: f.kind, fileId: f.id });
      });
      // Per-file chat comments — definitive activity source (replaces the
      // legacy annotation inference logic; matches designer/client portals).
      (commentsRes.data || []).forEach((c: any) => {
        bump(c.brief_id, c.sender_role, c.created_at, "note", {
          kind: fileKindById[c.file_id] || undefined,
          fileId: c.file_id,
          messageBody: c.body,
        });
      });

      // Up to 4 thumbnails per brief for the image-first card mosaic.
      const perBrief: Record<string, any[]> = {};
      (filesRes.data || []).forEach((f: any) => {
        if (!f.drive_file_id) return;
        (perBrief[f.brief_id] ||= []).push(f);
      });

      briefs.forEach((b: any) => {
        const c = counts[b.id] || { total: 0, designer: 0 };
        b.message_count = c.total;
        b.designer_message_count = c.designer;
        const la = lastByRole[b.id] || {};
        b.last_client_activity = la.client || null;
        b.last_designer_activity = la.designer || null;
        b.last_hpd_activity = la.hpd || null;
        const all = perBrief[b.id] || [];
        b.thumbs = all.slice(0, 4).map(f => ({ drive_file_id: f.drive_file_id, drive_link: f.drive_link, kind: f.kind }));
        b.thumb_total = all.length;
        b.thumb_file_id = b.thumbs[0]?.drive_file_id || null;
        b.thumb_link = b.thumbs[0]?.drive_link || null;

        // For HPD's view: external = client OR designer, whichever's most
        // recent. has_unread_external means HPD hasn't seen it yet.
        // hpdAt is max(actual HPD activity, hpd_last_seen_at) — opening
        // the modal counts as "seen" even if HPD didn't post anything.
        const clientAt = la.client?.at || "";
        const designerAt = la.designer?.at || "";
        const hpdActivityAt = la.hpd?.at || "";
        const hpdSeenAt = (b as any).hpd_last_seen_at || "";
        const hpdAt = hpdActivityAt > hpdSeenAt ? hpdActivityAt : hpdSeenAt;
        const latestExternal = clientAt > designerAt ? clientAt : designerAt;
        const latestExternalRole: "client" | "designer" = clientAt > designerAt ? "client" : "designer";
        const externalActivity = latestExternalRole === "client" ? la.client : la.designer;
        b.has_unread_external = !!latestExternal && latestExternal > hpdAt;
        b.unread_by_role = b.has_unread_external ? latestExternalRole : null;
        b.unread_kind = b.has_unread_external ? (externalActivity?.kind || null) : null;
        b.preview_line = (b.has_unread_external && externalActivity)
          ? formatActivityText({
              role: latestExternalRole as ActivityRole,
              type: externalActivity.type as ActivityType,
              kind: externalActivity.kind || null,
              ordinal: externalActivity.fileId ? ordinalsByFileId[externalActivity.fileId] || null : null,
              messageBody: externalActivity.messageBody || null,
            })
          : null;
        b.last_activity_at = [clientAt, designerAt, hpdAt].filter(Boolean).sort().pop() || b.updated_at || b.created_at;
      });
    }

    return NextResponse.json({ briefs });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// POST /api/art-briefs — create a new brief
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { item_id, job_id, client_id, title, concept, placement, colors, reference_urls, deadline, internal_notes, state, assigned_to, assigned_designer_id } = body;

    // Default designer: if caller didn't specify AND there's exactly one
    // active designer, pre-assign to them. Doesn't auto-send — HPD still clicks
    // "Send to Designer" when the brief is actually ready. New briefs stay in
    // draft (awaiting client info / HPD prep) regardless of designer assignment.
    let finalDesignerId: string | null = assigned_designer_id || null;
    if (!finalDesignerId) {
      const { data: activeDesigners } = await supabase.from("designers").select("id").eq("active", true);
      if (activeDesigners && activeDesigners.length === 1) {
        finalDesignerId = activeDesigners[0].id;
      }
    }

    const { data, error } = await supabase.from("art_briefs").insert({
      item_id: item_id || null,
      job_id: job_id || null,
      client_id: client_id || null,
      title, concept, placement, colors,
      reference_urls: reference_urls || [],
      deadline, internal_notes, assigned_to,
      assigned_designer_id: finalDesignerId,
      state: state || "draft",
      created_by: user.id,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ brief: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// PATCH /api/art-briefs — update a brief
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id, ...updates } = body;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    updates.updated_at = new Date().toISOString();

    const { data, error } = await supabase.from("art_briefs").update(updates).eq("id", id).select("*").single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ brief: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE /api/art-briefs?id=xxx — delete a brief
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await supabase.from("art_briefs").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
