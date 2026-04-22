import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { setFilePublicReadable, getDriveWebLink } from "@/lib/drive-resumable";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// POST — HPD registers a completed Drive upload. Called after the client
// successfully PUTs bytes to the resumable session URL.
// Body: { brief_id, drive_file_id, file_name, mime_type, file_size, kind, note? }
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { brief_id, drive_file_id, file_name, mime_type, file_size, kind, note } = await req.json();
    if (!brief_id || !drive_file_id || !file_name) {
      return NextResponse.json({ error: "brief_id, drive_file_id, file_name required" }, { status: 400 });
    }
    const k = (kind || "reference").toLowerCase();

    // Grant anonymous read so the thumbnail/preview URLs work
    try { await setFilePublicReadable(drive_file_id); } catch {}
    const webViewLink = await getDriveWebLink(drive_file_id);

    // Version only applies to uploaded creative work, not references
    let version = 1;
    if (["wip", "final", "print_ready"].includes(k)) {
      const { count } = await supabase.from("art_brief_files")
        .select("id", { count: "exact", head: true })
        .eq("brief_id", brief_id)
        .eq("kind", k);
      version = (count || 0) + 1;
    }

    const noteTrimmed = (note || "").trim() || null;
    const { data, error } = await supabase.from("art_brief_files").insert({
      brief_id,
      file_name,
      drive_file_id,
      drive_link: webViewLink,
      mime_type: mime_type || null,
      file_size: file_size || null,
      kind: k,
      version,
      uploader_role: "hpd",
      uploaded_by: user.id,
      hpd_annotation: noteTrimmed,
    }).select("*").single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // State transitions (match upload-reference legacy behavior)
    const now = new Date().toISOString();
    if (k === "wip" || k === "final") {
      await supabase.from("art_briefs").update({
        version_count: version,
        updated_at: now,
      }).eq("id", brief_id);
    }
    if (k === "print_ready") {
      await supabase.from("art_briefs").update({
        state: "production_ready",
        updated_at: now,
      }).eq("id", brief_id);
    }

    return NextResponse.json({ file: data });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
