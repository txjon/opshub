import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/art-briefs/promote-final
// Body: { brief_file_id, brief_id }
// Creates an item_files entry with stage=print_ready referencing the designer's final,
// and sets items.drive_link. No-op (success=true) if brief has no linked item.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_file_id, brief_id } = await req.json();
    if (!brief_file_id || !brief_id) {
      return NextResponse.json({ error: "brief_file_id and brief_id required" }, { status: 400 });
    }

    const { data: file, error: fErr } = await supabase
      .from("art_brief_files")
      .select("id, file_name, drive_file_id, drive_link, mime_type, file_size, kind, brief_id")
      .eq("id", brief_file_id)
      .single();
    if (fErr || !file) return NextResponse.json({ error: "File not found" }, { status: 404 });
    if (file.kind !== "final") return NextResponse.json({ error: "Only finals can be promoted" }, { status: 400 });

    const { data: brief } = await supabase
      .from("art_briefs")
      .select("id, item_id, job_id")
      .eq("id", brief_id)
      .single();
    if (!brief) return NextResponse.json({ error: "Brief not found" }, { status: 404 });

    if (!brief.item_id) {
      return NextResponse.json({ success: true, item_id: null, note: "Brief not linked to an item" });
    }

    // Avoid duplicate print_ready rows for same drive file
    const { data: existing } = await supabase
      .from("item_files")
      .select("id")
      .eq("item_id", brief.item_id)
      .eq("drive_file_id", file.drive_file_id || "")
      .maybeSingle();

    if (!existing && file.drive_file_id && file.drive_link) {
      const { error: iErr } = await supabase.from("item_files").insert({
        item_id: brief.item_id,
        file_name: file.file_name,
        stage: "print_ready",
        drive_file_id: file.drive_file_id,
        drive_link: file.drive_link,
        mime_type: file.mime_type,
        file_size: file.file_size,
        uploaded_by: user.id,
      });
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 });
    }

    // Update item.drive_link to the final's drive_link (matches existing print-ready auto-link behavior)
    if (file.drive_link) {
      await supabase.from("items").update({ drive_link: file.drive_link }).eq("id", brief.item_id);
    }

    // Move brief toward delivered state
    await supabase.from("art_briefs").update({
      state: "delivered",
      updated_at: new Date().toISOString(),
    }).eq("id", brief.id);

    return NextResponse.json({ success: true, item_id: brief.item_id });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
