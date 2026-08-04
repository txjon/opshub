import { NextRequest, NextResponse } from "next/server";
import { dbNoStore } from "@/lib/db-nostore";
import { isClientVisibleFile } from "@/lib/brief-visibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One design, client-side: the merged timeline through the WALL — only
// client-visible messages and shared files exist over here. The order ask
// rides as a minimal status ("we're pricing it"), never internal machinery.
const admin = dbNoStore;

export async function GET(_req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", params.token).single();
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, state, concept, approved_file_id, client_id, internal_only")
    .eq("id", params.briefId).eq("client_id", (client as any).id).eq("internal_only", false).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not your design" }, { status: 404 });

  const [{ data: messages }, { data: files }, { data: orderRequest }] = await Promise.all([
    db.from("art_brief_messages").select("id, sender_role, sender_name, message, created_at").eq("brief_id", params.briefId).eq("visibility", "client").order("created_at"),
    db.from("art_brief_files").select("id, file_name, drive_file_id, preview_drive_file_id, uploader_role, shared_with_client_at, kind, reaction, created_at").eq("brief_id", params.briefId).order("created_at"),
    db.from("lab_order_requests").select("blank, qty, handled_at").eq("brief_id", params.briefId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);

  const sharedFiles = ((files || []) as any[]).filter(f => isClientVisibleFile(f) && f.drive_file_id);
  const timeline = [
    ...((messages || []) as any[]).map(m => ({
      id: m.id, kind: "note",
      sender_role: m.sender_role === "client" ? "client" : "hpd",
      sender_name: m.sender_name, body: m.message,
      file_url: null, file_id: null, reaction: null, created_at: m.created_at,
    })),
    ...sharedFiles.map(f => ({
      id: `file-${f.id}`, kind: "file",
      sender_role: f.uploader_role === "client" ? "client" : "hpd",
      sender_name: null, body: null,
      file_url: `/api/files/thumbnail?id=${f.preview_drive_file_id || f.drive_file_id}&thumb=1&size=900`,
      file_id: f.id, reaction: f.reaction || null, created_at: f.created_at,
    })),
  ].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));

  return NextResponse.json({
    brief: { id: (brief as any).id, title: (brief as any).title, state: (brief as any).state, approved_file_id: (brief as any).approved_file_id },
    timeline,
    orderRequest: orderRequest ? { blank: (orderRequest as any).blank, qty: (orderRequest as any).qty, open: !(orderRequest as any).handled_at } : null,
  });
}
