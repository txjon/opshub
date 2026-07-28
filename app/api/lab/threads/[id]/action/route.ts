import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action } — the three state moves.
//   send_to_client  (HPD)    → with_client
//   approve         (client) → approved  (locks the latest art)
//   request_changes (client) → working   (note + optional photo)
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  const { data: thread } = await db.from("lab_threads").select("*, lab_clients(token, name)").eq("id", params.id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  const now = new Date().toISOString();
  const isClient = !!b.clientToken;
  if (isClient && (thread as any).lab_clients?.token !== b.clientToken) {
    return NextResponse.json({ error: "Not your thread" }, { status: 403 });
  }
  const name = (thread as any).lab_clients?.name || "Client";

  if (b.action === "send_to_client") {
    // The client must be able to SEE a design before we ask them to approve it —
    // no blank approvals (Jon, Jul 27). Mirrors the studio-side button gate.
    const { data: design } = await db.from("lab_messages")
      .select("id").eq("thread_id", params.id).eq("visibility", "client").not("file_url", "is", null)
      .limit(1).maybeSingle();
    if (!design) return NextResponse.json({ error: "Share a design the client can see before sending for approval" }, { status: 400 });
    await db.from("lab_threads").update({ state: "with_client", updated_at: now } as never).eq("id", params.id);
    await db.from("lab_messages").insert({
      thread_id: params.id, sender_role: "hpd", sender_name: b.senderName || "HPD",
      body: b.note ? String(b.note).trim() : "Sent your design over for approval.", visibility: "client", kind: "comment",
    } as never);
    return NextResponse.json({ ok: true, state: "with_client" });
  }

  if (b.action === "approve") {
    if (!isClient) return NextResponse.json({ error: "Only the client approves" }, { status: 403 });
    const { data: lastFile } = await db.from("lab_messages")
      .select("file_url").eq("thread_id", params.id).eq("visibility", "client").not("file_url", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    await db.from("lab_threads").update({
      state: "approved", approved_at: now, approved_by: name,
      approved_file_url: (lastFile as any)?.file_url || null, updated_at: now,
    } as never).eq("id", params.id);
    await db.from("lab_messages").insert({
      thread_id: params.id, sender_role: "client", sender_name: name,
      body: "✓ Approved the design for production.", visibility: "client", kind: "approval",
    } as never);
    return NextResponse.json({ ok: true, state: "approved" });
  }

  if (b.action === "request_changes") {
    if (!isClient) return NextResponse.json({ error: "Only the client requests changes" }, { status: 403 });
    await db.from("lab_threads").update({ state: "working", updated_at: now } as never).eq("id", params.id);
    await db.from("lab_messages").insert({
      thread_id: params.id, sender_role: "client", sender_name: name,
      body: b.note ? String(b.note).trim() : "Requested a change.", visibility: "client",
      file_url: b.fileUrl || null, file_name: b.fileName || null, kind: "change_request",
    } as never);
    return NextResponse.json({ ok: true, state: "working" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
