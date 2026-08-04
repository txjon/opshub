import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";
import { sendInternalMail } from "@/lib/internal-mail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { action } — the client's moves, social-style. Handing a design TO the
// client is just a Client-visible message (see the messages route).
//
// The thumb is the light act; the sheet's doors are the heavy ones:
//   like            → marker + reaction='up' on the design. NO state move — a
//                     bare like never moves the ball (and un-passes the design).
//   approve         → "Bank it": approved, locks the thumbed design (or the
//                     latest we sent). The greenlight.
//   order           → "Order it": bank + an order request (blank/qty/note) on
//                     the studio rail + internal mail. Still just an ask —
//                     price is yes #2, never implied here.
//   request_changes → the instant thumbs-down: version passes (reaction='down'),
//                     thread back to us. Optional note rides along.
//   shelve          → idea-level: not now, not wrong. Leaves their view.
//   kill            → idea-level: done exploring. Record only.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  const { data: thread } = await db.from("lab_threads").select("*, lab_clients(id, token, name)").eq("id", params.id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Thread not found" }, { status: 404 });
  const now = new Date().toISOString();
  const isClient = !!b.clientToken;
  if (isClient && (thread as any).lab_clients?.token !== b.clientToken) {
    return NextResponse.json({ error: "Not your thread" }, { status: 403 });
  }
  const name = (thread as any).lab_clients?.name || "Client";

  // A design WE sent (client-visible HPD image) — the only thing thumbs act on.
  // messageId pins the thumbed design; without it, latest wins.
  async function hpdDesign(messageId?: string) {
    let q = db.from("lab_messages")
      .select("id, file_url").eq("thread_id", params.id).eq("visibility", "client").eq("sender_role", "hpd").not("file_url", "is", null);
    if (messageId) q = q.eq("id", messageId);
    const { data } = await q.order("created_at", { ascending: false }).limit(1).maybeSingle();
    return data as { id: string; file_url: string } | null;
  }
  const marker = (body: string, kind: string) =>
    db.from("lab_messages").insert({ thread_id: params.id, sender_role: "client", sender_name: name, body, visibility: "client", kind } as never);

  if (b.action === "like") {
    if (!isClient) return NextResponse.json({ error: "Only the client reacts" }, { status: 403 });
    const design = await hpdDesign(b.messageId);
    if (!design) return NextResponse.json({ error: "Nothing to react to yet" }, { status: 400 });
    // Idempotent: a design that's already liked doesn't re-mark the thread.
    const { data: cur } = await db.from("lab_messages").select("reaction").eq("id", design.id).maybeSingle();
    if ((cur as any)?.reaction !== "up") {
      await db.from("lab_messages").update({ reaction: "up" } as never).eq("id", design.id);
      await marker("✓ Liked this one.", "like");
      await db.from("lab_threads").update({ updated_at: now } as never).eq("id", params.id);
    }
    return NextResponse.json({ ok: true, state: (thread as any).state });
  }

  if (b.action === "approve" || b.action === "order") {
    if (!isClient) return NextResponse.json({ error: "Only the client approves" }, { status: 403 });
    const design = await hpdDesign(b.messageId);
    if (!design) return NextResponse.json({ error: "There's no design to approve yet" }, { status: 400 });
    await db.from("lab_threads").update({
      state: "approved", approved_at: now, approved_by: name,
      approved_file_url: design.file_url, updated_at: now,
    } as never).eq("id", params.id);
    // The greenlight un-passes the design it locks (a changed mind).
    await db.from("lab_messages").update({ reaction: "up" } as never).eq("id", design.id);

    if (b.action === "approve") {
      await marker("✓ Banked this design.", "approval");
      return NextResponse.json({ ok: true, state: "approved" });
    }

    // Order it — capture the ask, surface it on the rail, ping the team.
    const blank = b.blank ? String(b.blank).trim() : null;
    const qty = Number.isFinite(Number(b.qty)) && Number(b.qty) > 0 ? Math.round(Number(b.qty)) : null;
    const note = b.note ? String(b.note).trim() : null;
    const { error: reqErr } = await db.from("lab_order_requests").insert({
      thread_id: params.id, client_id: (thread as any).lab_clients?.id || (thread as any).client_id,
      design_msg_id: design.id, design_file_url: design.file_url,
      blank, qty, note,
    } as never);
    if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 });
    await marker(`✓ Ordered this design: ${blank || "blank TBD"}${qty ? `, ${qty} pieces` : ""}.`, "order");
    sendInternalMail({ kind: "lab_order_request", client: name, title: (thread as any).title, blank, qty, note }).catch(() => {});
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

  if (b.action === "shelve" || b.action === "kill") {
    if (!isClient) return NextResponse.json({ error: "Only the client decides this" }, { status: 403 });
    const killed = b.action === "kill";
    await db.from("lab_threads").update({ state: killed ? "killed" : "shelved", updated_at: now } as never).eq("id", params.id);
    await marker(killed ? "✕ Killed this idea." : "✓ Shelved for later.", "change_request");
    return NextResponse.json({ ok: true, state: killed ? "killed" : "shelved" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
