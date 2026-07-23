import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?clientToken=xxx → that client's threads (client hub). No token → every
// thread with its client (the studio list).
export async function GET(req: NextRequest) {
  const db = labDb();
  const clientToken = req.nextUrl.searchParams.get("clientToken");
  if (clientToken) {
    const { data: client } = await db.from("lab_clients").select("id, name, token").eq("token", clientToken).maybeSingle();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const { data: threads } = await db.from("lab_threads").select("*").eq("client_id", (client as any).id).order("updated_at", { ascending: false });
    return NextResponse.json({ client, threads: threads || [] });
  }
  const { data: threads } = await db.from("lab_threads").select("*, lab_clients(name, token)").order("updated_at", { ascending: false });
  return NextResponse.json({ threads: threads || [] });
}

// POST — start a thread. Client-initiated (clientToken) OR HPD-initiated
// (clientId + senderName). An opening note/file rides in as the first message.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  let clientId = b.clientId;
  let initiatedBy: "hpd" | "client" = "hpd";
  let senderRole: "hpd" | "client" = "hpd";
  let senderName = b.senderName || "HPD";
  if (b.clientToken) {
    const { data: client } = await db.from("lab_clients").select("id, name").eq("token", b.clientToken).maybeSingle();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    clientId = (client as any).id; initiatedBy = "client"; senderRole = "client"; senderName = (client as any).name;
  }
  if (!clientId || !b.title || !String(b.title).trim()) {
    return NextResponse.json({ error: "A client and a title are required" }, { status: 400 });
  }
  const { data: thread, error } = await db.from("lab_threads").insert({
    client_id: clientId, title: String(b.title).trim(), state: "working", initiated_by: initiatedBy,
  } as never).select("*").single();
  if (error || !thread) return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });

  if ((b.body && String(b.body).trim()) || b.fileUrl) {
    await db.from("lab_messages").insert({
      thread_id: (thread as any).id, sender_role: senderRole, sender_name: senderName,
      body: b.body ? String(b.body).trim() : null, visibility: "client",
      file_url: b.fileUrl || null, file_name: b.fileName || null, kind: "submission",
    } as never);
  }
  return NextResponse.json({ thread });
}
