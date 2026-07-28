import { NextRequest, NextResponse } from "next/server";
import { labDb, newToken } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?threadId= → work orders for a design (studio list).
// GET ?token=    → resolve one work order by its designer token + its thread
//                  (the designer portal). Room 2 has no internal wall — the
//                  designer sees the whole work-order thread.
export async function GET(req: NextRequest) {
  const db = labDb();
  const threadId = req.nextUrl.searchParams.get("threadId");
  const token = req.nextUrl.searchParams.get("token");
  if (token) {
    const { data: wo } = await db.from("lab_work_orders").select("*").eq("token", token).maybeSingle();
    if (!wo) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
    const { data: messages } = await db.from("lab_wo_messages").select("*").eq("work_order_id", (wo as any).id).order("created_at", { ascending: true });
    return NextResponse.json({ workOrder: wo, messages: messages || [] });
  }
  if (threadId) {
    const { data } = await db.from("lab_work_orders").select("*").eq("thread_id", threadId).order("created_at", { ascending: false });
    return NextResponse.json({ workOrders: data || [] });
  }
  return NextResponse.json({ error: "threadId or token required" }, { status: 400 });
}

// POST — hand a design to a designer. Creates the work order (with its token)
// and seeds the brief (instructions + the design we're handing over, client
// identity stripped) as the first message.
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  if (!b.threadId || !["creative", "vector", "separations"].includes(b.type)) {
    return NextResponse.json({ error: "A design and a type are required" }, { status: 400 });
  }
  const { data: thread } = await db.from("lab_threads").select("id, title").eq("id", b.threadId).maybeSingle();
  if (!thread) return NextResponse.json({ error: "Design not found" }, { status: 404 });

  const token = newToken();
  const { data: wo, error } = await db.from("lab_work_orders").insert({
    thread_id: b.threadId, type: b.type, title: (thread as any).title || null,
    instructions: b.instructions ? String(b.instructions).trim() : null,
    due_by: b.dueBy || null,
    designer_name: b.designerName ? String(b.designerName).trim() : null,
    token, source_file_url: b.sourceFileUrl || null, created_by: b.senderName || "HPD",
  } as never).select("*").single();
  if (error || !wo) return NextResponse.json({ error: error?.message || "Failed" }, { status: 500 });

  // Seed the brief so the designer opens onto context — NOT the client's name.
  await db.from("lab_wo_messages").insert({
    work_order_id: (wo as any).id, sender_role: "hpd", sender_name: b.senderName || "HPD",
    body: b.instructions ? String(b.instructions).trim() : "Here's what we need.",
    file_url: b.sourceFileUrl || null, file_name: b.sourceFileName || null, kind: "comment",
  } as never);

  return NextResponse.json({ workOrder: wo });
}
