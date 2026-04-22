import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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
      if (briefRes.error) return NextResponse.json({ error: briefRes.error.message }, { status: 404 });
      return NextResponse.json({
        brief: briefRes.data,
        files: filesRes.data || [],
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
      const [msgsRes, filesRes] = await Promise.all([
        supabase.from("art_brief_messages").select("brief_id, sender_role, created_at").in("brief_id", ids),
        supabase.from("art_brief_files").select("brief_id, drive_file_id, drive_link, kind, uploader_role, created_at, annotation_updated_at, client_annotation, designer_annotation, hpd_annotation").in("brief_id", ids).order("created_at", { ascending: false }),
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
      type Activity = { at: string; type: "message" | "upload" | "note"; kind?: string };
      const lastByRole: Record<string, { client?: Activity; designer?: Activity; hpd?: Activity }> = {};
      const bump = (bid: string, role: string | null | undefined, at: string, type: "message" | "upload" | "note", kind?: string) => {
        const r = role === "client" ? "client" : role === "designer" ? "designer" : "hpd";
        const slot = (lastByRole[bid] ||= {});
        const cur = (slot as any)[r] as Activity | undefined;
        if (!cur || (at || "") > cur.at) (slot as any)[r] = { at, type, kind };
      };
      (msgsRes.data || []).forEach((m: any) => bump(m.brief_id, m.sender_role, m.created_at, "message"));
      // Files: upload event attributed to uploader. Annotation edits use
      // smart inference since we share one annotation_updated_at across all
      // three roles: if the role matches the file's uploader, assume the
      // annotation was set at upload (use created_at). Otherwise it was
      // PATCHed later (use shared). This prevents HPD's PATCH time from
      // being attributed to the designer's upload-time note, which broke
      // unread-badge math.
      (filesRes.data || []).forEach((f: any) => {
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
      });

      // Up to 4 thumbnails per brief for the image-first card mosaic.
      // Sort by "last touched" — upload OR annotation edit — so notes-only
      // activity bumps the tile preview.
      const lastTouched = (f: any) => {
        const c = f.created_at || "";
        const a = f.annotation_updated_at || "";
        return c > a ? c : a;
      };
      const perBrief: Record<string, any[]> = {};
      (filesRes.data || []).forEach((f: any) => {
        if (!f.drive_file_id) return;
        (perBrief[f.brief_id] ||= []).push(f);
      });
      Object.keys(perBrief).forEach(bid => {
        perBrief[bid].sort((a, b) => lastTouched(b).localeCompare(lastTouched(a)));
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
        b.thumbs = all.slice(0, 4).map(f => ({ drive_file_id: f.drive_file_id, drive_link: f.drive_link }));
        b.thumb_total = all.length;
        // Backward-compat single fields (kept so nothing else breaks)
        b.thumb_file_id = b.thumbs[0]?.drive_file_id || null;
        b.thumb_link = b.thumbs[0]?.drive_link || null;
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
