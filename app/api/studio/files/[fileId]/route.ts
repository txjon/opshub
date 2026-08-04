import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";
import { LEGACY_CLIENT_KINDS } from "@/lib/brief-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { share: boolean } — flip a version across the WALL after the fact:
// share stamps shared_with_client_at (the client gains it in their filmstrip,
// no state move — sharing a file is not handing the ball); unshare clears it
// (no-op for legacy client-facing kinds, which are visible BY KIND).
export async function PATCH(req: NextRequest, { params }: { params: { fileId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, any> = { shared_with_client_at: b.share ? new Date().toISOString() : null };
  if (!b.share) {
    // Legacy kinds are client-visible BY KIND — clearing the stamp alone
    // wouldn't hide them. Making one internal reclassifies it to 'wip'.
    const { data: f } = await db.from("art_brief_files").select("kind").eq("id", params.fileId).maybeSingle();
    if (f && LEGACY_CLIENT_KINDS.includes(String((f as any).kind || ""))) patch.kind = "wip";
  }
  const { error } = await db.from("art_brief_files").update(patch as never).eq("id", params.fileId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// Delete one design version from a brief (studio-side). The row goes; the
// Drive file is trashed ONLY if nothing else references it (the shared-drive
// ref-count rule — the fork copies brief art onto items BY REFERENCE, so a
// blind delete would wipe another surface's art).
export async function DELETE(_req: NextRequest, { params }: { params: { fileId: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();

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
