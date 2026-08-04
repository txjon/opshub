import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Latest image per thread (for the art-forward cards). clientOnly = the client
// only ever sees client-visible art. Passed-on designs (reaction='down') never
// front a card — fall back to the newest live image.
async function latestArt(db: any, ids: string[], clientOnly: boolean): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  if (!ids.length) return out;
  let q = db.from("lab_messages").select("thread_id, file_url, created_at").in("thread_id", ids).not("file_url", "is", null).or("reaction.is.null,reaction.neq.down").order("created_at", { ascending: false });
  if (clientOnly) q = q.eq("visibility", "client");
  const { data } = await q;
  for (const f of (data || []) as any[]) if (!out[f.thread_id]) out[f.thread_id] = f.file_url;
  return out;
}

// GET ?clientToken=xxx → that client's threads (client hub). No token → every
// thread with its client (the studio list).
export async function GET(req: NextRequest) {
  const db = labDb();
  const clientToken = req.nextUrl.searchParams.get("clientToken");
  if (clientToken) {
    const { data: client } = await db.from("lab_clients").select("id, name, token").eq("token", clientToken).maybeSingle();
    if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const { data: threads } = await db.from("lab_threads").select("*").eq("client_id", (client as any).id).order("updated_at", { ascending: false });
    const list = (threads || []) as any[];
    // A design only surfaces to the client once there's a reason to: they started
    // it, it's been sent/approved, or we've shared something client-visible. A
    // blank HPD-started design stays our prep until then (no more "in the works"
    // on an empty thread — Jon, Jul 22).
    const ids = list.map(t => t.id);
    let hasClientMsg = new Set<string>();
    if (ids.length) {
      const { data: cm } = await db.from("lab_messages").select("thread_id").in("thread_id", ids).eq("visibility", "client");
      hasClientMsg = new Set((cm || []).map((m: any) => m.thread_id));
    }
    const visible = list.filter(t => t.initiated_by === "client" || t.state === "with_client" || t.state === "approved" || hasClientMsg.has(t.id));
    const cArt = await latestArt(db, visible.map(t => t.id), true);
    return NextResponse.json({ client, threads: visible.map(t => ({ ...t, _art: cArt[t.id] || null })) });
  }
  const { data: threads } = await db.from("lab_threads").select("*, lab_clients(name, token)").order("updated_at", { ascending: false });
  const hlist = (threads || []) as any[];
  const hArt = await latestArt(db, hlist.map(t => t.id), false);
  // Bridged threads carry their job — the studio sheds them into the
  // "In the pipeline" line (finished work lives in the client space, not here).
  const jobByThread: Record<string, any> = {};
  if (hlist.length) {
    const { data: bridgedReqs } = await db.from("lab_order_requests")
      .select("thread_id, job_id, jobs(job_number)").in("thread_id", hlist.map(t => t.id)).not("job_id", "is", null);
    for (const r of (bridgedReqs || []) as any[]) jobByThread[r.thread_id] = { id: r.job_id, number: r.jobs?.job_number || null };
  }
  return NextResponse.json({ threads: hlist.map(t => ({ ...t, _art: hArt[t.id] || null, _job: jobByThread[t.id] || null })) });
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
