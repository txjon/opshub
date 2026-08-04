import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET one thread + its messages. With ?clientToken=xxx the caller is the client
// — verify they own it and hand back ONLY client-visible messages (the wall).
// No token = the studio view, everything.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const db = labDb();
  const clientToken = req.nextUrl.searchParams.get("clientToken");
  const { data: thread } = await db.from("lab_threads").select("*, lab_clients(name, token)").eq("id", params.id).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let clientView = false;
  if (clientToken) {
    if ((thread as any).lab_clients?.token !== clientToken) return NextResponse.json({ error: "Not your thread" }, { status: 403 });
    clientView = true;
  }
  let q = db.from("lab_messages").select("*").eq("thread_id", params.id).order("created_at", { ascending: true });
  if (clientView) q = q.eq("visibility", "client");
  const { data: messages } = await q;
  // The latest order request rides along so both sheets can show "request in,
  // pricing it" (client) / the ask itself (studio).
  const { data: orderRequest } = await db.from("lab_order_requests")
    .select("id, blank, qty, note, handled_at, created_at")
    .eq("thread_id", params.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return NextResponse.json({ thread, messages: messages || [], orderRequest: orderRequest || null, clientView });
}

// DELETE — remove a design (cascades its messages). Studio-side only (the lab is
// open); the client hub never calls this.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = labDb();
  const { error } = await db.from("lab_threads").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
