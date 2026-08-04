import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One design's sheet: the brief + a MERGED timeline (textual messages and
// files as one chronological stream — the Lab's shape, so the proven sheet
// UI renders unchanged) + the latest order request. DELETE removes the
// design outright (files/messages cascade; Drive files stay put — history
// is supersede-shaped, never destroyed).
const admin = dbNoStore;
async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  const { data: brief } = await db.from("art_briefs")
    .select("*, clients(id, name)").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const [{ data: messages }, { data: files }, { data: orderRequest }] = await Promise.all([
    db.from("art_brief_messages").select("id, sender_role, sender_name, message, visibility, created_at").eq("brief_id", params.id).order("created_at"),
    db.from("art_brief_files").select("id, file_name, kind, drive_file_id, preview_drive_file_id, drive_link, mime_type, uploader_role, shared_with_client_at, reaction, created_at").eq("brief_id", params.id).order("created_at"),
    db.from("lab_order_requests").select("id, blank, qty, note, handled_at, job_id, created_at, jobs(job_number)").eq("brief_id", params.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  // The merged timeline, Lab-shaped: files are "messages with a file_url".
  const timeline = [
    ...((messages || []) as any[]).map(m => ({
      id: m.id, kind: "note",
      sender_role: m.sender_role === "client" ? "client" : "hpd",
      sender_name: m.sender_name,
      body: m.message, visibility: m.visibility,
      file_url: null, file_id: null, reaction: null, created_at: m.created_at,
    })),
    ...((files || []) as any[]).map(f => ({
      id: `file-${f.id}`, kind: "file",
      sender_role: f.uploader_role === "client" ? "client" : "hpd",
      sender_name: f.uploader_role === "designer" ? "Designer" : f.uploader_role === "client" ? (brief as any).clients?.name || "Client" : "HPD",
      body: null,
      visibility: f.shared_with_client_at || f.uploader_role === "client" ? "client" : "internal",
      file_url: `/api/files/thumbnail?id=${f.preview_drive_file_id || f.drive_file_id}&thumb=1&size=900`,
      drive_link: f.drive_link, file_id: f.id, file_kind: f.kind,
      reaction: f.reaction || null, created_at: f.created_at,
    })),
  ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  return NextResponse.json({ brief, timeline, orderRequest: orderRequest || null });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await requireUser())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const db = admin();
  await db.from("products").delete().eq("brief_id", params.id);
  const { error } = await db.from("art_briefs").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
