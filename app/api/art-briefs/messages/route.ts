import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST — add a message to a brief
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, message, visibility } = await req.json();
    if (!brief_id || !message?.trim()) return NextResponse.json({ error: "brief_id and message required" }, { status: 400 });

    // Get sender name from profile
    const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();

    const { data, error } = await supabase.from("art_brief_messages").insert({
      brief_id,
      sender_role: "hpd",
      sender_name: profile?.full_name || null,
      sender_id: user.id,
      message: message.trim(),
      visibility: visibility || "all",
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ message: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE — remove a message (HPD only)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { error } = await supabase.from("art_brief_messages").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
