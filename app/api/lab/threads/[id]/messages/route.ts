import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — add to the thread. HPD posts with a visibility flag (client|internal);
// a client (clientToken) can only ever post client-visible. Optional file.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();

  const { data: thread } = await db.from("lab_threads").select("id, client_id, lab_clients(token, name)").eq("id", params.id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });

  let senderRole: "hpd" | "client" = "hpd";
  let senderName = b.senderName || "HPD";
  let visibility: "client" | "internal" = b.visibility === "internal" ? "internal" : "client";
  if (b.clientToken) {
    if ((thread as any).lab_clients?.token !== b.clientToken) return NextResponse.json({ error: "Not your thread" }, { status: 403 });
    senderRole = "client"; senderName = (thread as any).lab_clients?.name || "Client"; visibility = "client";
  }
  if (!(b.body && String(b.body).trim()) && !b.fileUrl) {
    return NextResponse.json({ error: "Say something or add a file" }, { status: 400 });
  }
  const { data: msg, error } = await db.from("lab_messages").insert({
    thread_id: params.id, sender_role: senderRole, sender_name: senderName,
    body: b.body ? String(b.body).trim() : null, visibility,
    file_url: b.fileUrl || null, file_name: b.fileName || null,
    kind: b.fileUrl ? "version" : "comment",
  } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("lab_threads").update({ updated_at: new Date().toISOString() } as never).eq("id", params.id);
  return NextResponse.json({ message: msg });
}
