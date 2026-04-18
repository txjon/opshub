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

    if (id) {
      const [briefRes, filesRes, msgsRes] = await Promise.all([
        supabase.from("art_briefs").select("*, items(name), jobs(title, job_number), clients(name)").eq("id", id).single(),
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

    let query = supabase.from("art_briefs").select("*, items(name), jobs(title, job_number, job_type), clients(name)").order("created_at", { ascending: false });
    if (itemId) query = query.eq("item_id", itemId);
    if (jobId) query = query.eq("job_id", jobId);
    if (clientId) query = query.eq("client_id", clientId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Attach message counts + best thumbnail per brief in one extra fetch
    const briefs = data || [];
    if (briefs.length > 0) {
      const ids = briefs.map((b: any) => b.id);
      const [msgsRes, filesRes] = await Promise.all([
        supabase.from("art_brief_messages").select("brief_id, sender_role").in("brief_id", ids),
        supabase.from("art_brief_files").select("brief_id, drive_file_id, drive_link, kind, created_at").in("brief_id", ids).order("created_at", { ascending: false }),
      ]);

      // Message counts
      const counts: Record<string, { total: number; designer: number }> = {};
      (msgsRes.data || []).forEach((m: any) => {
        const c = counts[m.brief_id] ||= { total: 0, designer: 0 };
        c.total++;
        if (m.sender_role === "designer") c.designer++;
      });

      // Up to 4 thumbnails per brief for the image-first card mosaic.
      // Priority: final > wip > reference > client_intake, newest first within kind.
      const rank: Record<string, number> = { final: 4, wip: 3, reference: 2, client_intake: 1 };
      const perBrief: Record<string, Array<{ drive_file_id: string; drive_link: string | null; kind: string; created_at: string }>> = {};
      (filesRes.data || []).forEach((f: any) => {
        if (!f.drive_file_id) return;
        (perBrief[f.brief_id] ||= []).push(f);
      });
      Object.keys(perBrief).forEach(bid => {
        perBrief[bid].sort((a, b) => {
          const r = (rank[b.kind] || 0) - (rank[a.kind] || 0);
          if (r !== 0) return r;
          return (b.created_at || "").localeCompare(a.created_at || "");
        });
      });

      briefs.forEach((b: any) => {
        const c = counts[b.id] || { total: 0, designer: 0 };
        b.message_count = c.total;
        b.designer_message_count = c.designer;
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
    const { item_id, job_id, client_id, title, concept, placement, colors, reference_urls, deadline, internal_notes, state, assigned_to } = body;

    const { data, error } = await supabase.from("art_briefs").insert({
      item_id: item_id || null,
      job_id: job_id || null,
      client_id: client_id || null,
      title, concept, placement, colors,
      reference_urls: reference_urls || [],
      deadline, internal_notes, assigned_to,
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
