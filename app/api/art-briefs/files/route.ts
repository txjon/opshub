import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { deleteFile } from "@/lib/google-drive";

// POST — register a file uploaded to Drive as part of a brief
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, file_name, drive_file_id, drive_link, mime_type, file_size, kind, notes, uploader_role } = await req.json();
    if (!brief_id || !file_name) return NextResponse.json({ error: "brief_id and file_name required" }, { status: 400 });

    // Determine version for WIP/final uploads
    let version = 1;
    if (kind === "wip" || kind === "final") {
      const { count } = await supabase.from("art_brief_files").select("id", { count: "exact", head: true }).eq("brief_id", brief_id).eq("kind", kind);
      version = (count || 0) + 1;
    }

    const { data, error } = await supabase.from("art_brief_files").insert({
      brief_id, file_name, drive_file_id, drive_link, mime_type, file_size,
      kind: kind || "reference",
      version,
      notes,
      uploaded_by: user.id,
      uploader_role: uploader_role || "hpd",
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Bump brief version_count on WIP/final
    if (kind === "wip" || kind === "final") {
      await supabase.from("art_briefs").update({ version_count: version, updated_at: new Date().toISOString() }).eq("id", brief_id);
    }

    return NextResponse.json({ file: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}

// DELETE — remove a file (Drive + DB)
export async function DELETE(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

    const { data: file } = await supabase.from("art_brief_files").select("drive_file_id").eq("id", id).single();
    if (file?.drive_file_id) {
      try { await deleteFile(file.drive_file_id); } catch {}
    }

    const { error } = await supabase.from("art_brief_files").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
