import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Delete one design version from a brief (studio-side). The row goes; the
// Drive file is trashed ONLY if nothing else references it (the shared-drive
// ref-count rule — the fork copies brief art onto items BY REFERENCE, so a
// blind delete would wipe another surface's art).
export async function DELETE(_req: NextRequest, { params }: { params: { fileId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: file } = await db.from("art_brief_files")
    .select("id, brief_id, drive_file_id").eq("id", params.fileId).maybeSingle();
  if (!file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If this version is the banked pin, unpin first.
  await db.from("art_briefs").update({ approved_file_id: null })
    .eq("id", (file as any).brief_id).eq("approved_file_id", params.fileId);
  const { error } = await db.from("art_brief_files").delete().eq("id", params.fileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const driveId = (file as any).drive_file_id;
  if (driveId) {
    // Two ref surfaces: sibling brief files first, then the helper checks
    // item_files (the fork copies by reference) and trashes only when clean.
    const { count } = await db.from("art_brief_files").select("id", { count: "exact", head: true }).eq("drive_file_id", driveId);
    if ((count || 0) === 0) { try { await deleteDriveFileIfUnreferenced(driveId); } catch {} }
  }
  return NextResponse.json({ ok: true });
}
