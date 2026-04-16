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
    const id = req.nextUrl.searchParams.get("id");

    if (id) {
      const [briefRes, filesRes, msgsRes] = await Promise.all([
        supabase.from("art_briefs").select("*").eq("id", id).single(),
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

    let query = supabase.from("art_briefs").select("*").order("created_at", { ascending: false });
    if (itemId) query = query.eq("item_id", itemId);
    if (jobId) query = query.eq("job_id", jobId);

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ briefs: data || [] });
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
    const { item_id, job_id, title, concept, placement, colors, reference_urls, deadline, internal_notes, state, assigned_to } = body;

    if (!item_id || !job_id) return NextResponse.json({ error: "item_id and job_id required" }, { status: 400 });

    const { data, error } = await supabase.from("art_briefs").insert({
      item_id, job_id, title, concept, placement, colors,
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
