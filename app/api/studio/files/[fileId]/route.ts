import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser } from "@/lib/studio-access";
import { dbNoStore } from "@/lib/db-nostore";
import { removeBriefFile } from "@/lib/brief-files-server";
import { LEGACY_CLIENT_KINDS } from "@/lib/brief-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { share: boolean } — flip a version across the WALL after the fact:
// share stamps shared_with_client_at (the client gains it in their filmstrip,
// no state move — sharing a file is not handing the ball); unshare clears it
// (no-op for legacy client-facing kinds, which are visible BY KIND).
export async function PATCH(req: NextRequest, { params }: { params: { fileId: string } }) {
  const supabase = await createClient();
  const user = await studioUser(supabase);
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
  const user = await studioUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();

  const err = await removeBriefFile(db, params.fileId, { trash: true });
  if (err === "Not found") return NextResponse.json({ error: err }, { status: 404 });
  if (err) return NextResponse.json({ error: err }, { status: 500 });
  return NextResponse.json({ ok: true });
}
