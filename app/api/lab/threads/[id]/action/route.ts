import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action } — the client's two moves, social-style. Handing a design TO
// the client is just a Client-visible message (see the messages route).
//   approve         (client) → approved  (thumbs up — locks the thumbed design,
//                                         or the latest we sent if no messageId)
//   request_changes (client) → working   (thumbs down — optional note + photo;
//                                         stamps reaction='down' on the design
//                                         so it drops into the passed strip)
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

  if (b.action === "approve") {
    if (!isClient) return NextResponse.json({ error: "Only the client approves" }, { status: 403 });
    // Lock a design WE sent (a client-visible HPD image) — never the client's
    // own uploads. messageId pins the thumbed design (a thumbs-up can rescue an
    // earlier or even passed-on version); without it, latest wins.
    let q = db.from("lab_messages")
      .select("id, file_url").eq("thread_id", params.id).eq("visibility", "client").eq("sender_role", "hpd").not("file_url", "is", null);
    if (b.messageId) q = q.eq("id", b.messageId);
    const { data: lastFile } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!lastFile) return NextResponse.json({ error: "There's no design to approve yet" }, { status: 400 });
    await db.from("lab_threads").update({
      state: "approved", approved_at: now, approved_by: name,
      approved_file_url: (lastFile as any).file_url, updated_at: now,
    } as never).eq("id", params.id);
    // A changed mind un-passes the design it locks.
    await db.from("lab_messages").update({ reaction: null } as never).eq("id", (lastFile as any).id);
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
      body: b.note ? String(b.note).trim() : "Passed on this one.", visibility: "client",
      file_url: b.fileUrl || null, file_name: b.fileName || null, kind: "change_request",
    } as never);
    // Thumbs down on a specific design tucks it into the passed strip — only an
    // HPD-sent design in this thread can be passed on.
    if (b.messageId) {
      await db.from("lab_messages").update({ reaction: "down" } as never)
        .eq("id", b.messageId).eq("thread_id", params.id).eq("sender_role", "hpd");
    }
    return NextResponse.json({ ok: true, state: "working" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
