import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET one work order + its whole message thread (studio side).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const db = labDb();
  const { data: workOrder } = await db.from("lab_work_orders").select("*").eq("id", params.id).maybeSingle();
  if (!workOrder) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { data: messages } = await db.from("lab_wo_messages").select("*").eq("work_order_id", params.id).order("created_at", { ascending: true });
  return NextResponse.json({ workOrder, messages: messages || [] });
}

// PATCH { action: "accept" } — accept the delivery: lock the latest designer
// file as the production-ready art. That's the file we needed; Room 2 closes.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  if (b.action !== "accept") return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  const { data: lastFile } = await db.from("lab_wo_messages")
    .select("file_url").eq("work_order_id", params.id).eq("sender_role", "designer").not("file_url", "is", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastFile) return NextResponse.json({ error: "No delivery to accept yet" }, { status: 400 });
  const now = new Date().toISOString();
  await db.from("lab_work_orders").update({
    state: "accepted", accepted_file_url: (lastFile as any).file_url, updated_at: now,
  } as never).eq("id", params.id);
  await db.from("lab_wo_messages").insert({
    work_order_id: params.id, sender_role: "hpd", sender_name: b.senderName || "HPD",
    body: "✓ Accepted — this is the file.", kind: "accept",
  } as never);
  return NextResponse.json({ ok: true, state: "accepted" });
}
