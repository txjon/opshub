import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH { label } — name an option ("Washed Navy"). DELETE — pull an option
// from a DRAFT round; the Drive file is trashed only when nothing else
// references it (shared-asset rule: brief files, item files, other options).
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string; optId: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const b = await req.json().catch(() => ({}));
  const { error } = await db.from("lineup_options")
    .update({ label: String(b.label || "").trim().slice(0, 60) || null } as never)
    .eq("id", params.optId).eq("lineup_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string; optId: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = dbNoStore();
  const { data: lineup } = await db.from("lineups").select("sent_at").eq("id", params.id).maybeSingle();
  if ((lineup as any)?.sent_at) return NextResponse.json({ error: "Sent rounds don't edit" }, { status: 409 });
  const { data: opt } = await db.from("lineup_options").select("drive_file_id").eq("id", params.optId).maybeSingle();
  const { error } = await db.from("lineup_options").delete().eq("id", params.optId).eq("lineup_id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const driveId = (opt as any)?.drive_file_id;
  if (driveId) {
    const { count: c1 } = await db.from("art_brief_files").select("id", { count: "exact", head: true }).eq("drive_file_id", driveId);
    const { count: c2 } = await db.from("lineup_options").select("id", { count: "exact", head: true }).eq("drive_file_id", driveId);
    if ((c1 || 0) + (c2 || 0) === 0) { try { await deleteDriveFileIfUnreferenced(driveId); } catch {} }
  }
  return NextResponse.json({ ok: true });
}
