import { NextRequest, NextResponse } from "next/server";
import { labDb } from "@/lib/lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST — add to a work-order thread. designerToken → the designer (verified
// against the work order's token); else HPD. A designer file = a delivery; our
// reply on a delivery = a revision ask. Loose state, no dead-ends.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const b = await req.json().catch(() => ({}));
  const db = labDb();
  const { data: wo } = await db.from("lab_work_orders").select("id, token, state, designer_name").eq("id", params.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: "Work order not found" }, { status: 404 });

  let senderRole: "hpd" | "designer" = "hpd";
  let senderName = b.senderName || "HPD";
  if (b.designerToken) {
    if ((wo as any).token !== b.designerToken) return NextResponse.json({ error: "Not your work order" }, { status: 403 });
    senderRole = "designer";
    senderName = (b.senderName && String(b.senderName).trim()) || (wo as any).designer_name || "Designer";
  }
  if (!(b.body && String(b.body).trim()) && !b.fileUrl) {
    return NextResponse.json({ error: "Say something or add a file" }, { status: 400 });
  }
  const isDelivery = senderRole === "designer" && !!b.fileUrl;

  const { data: msg, error } = await db.from("lab_wo_messages").insert({
    work_order_id: params.id, sender_role: senderRole, sender_name: senderName,
    body: b.body ? String(b.body).trim() : null, file_url: b.fileUrl || null, file_name: b.fileName || null,
    kind: isDelivery ? "delivery" : "comment",
  } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Loose state: a designer delivery → delivered; our reply on a delivery →
  // in_revision. Never disturb an accepted order.
  const cur = (wo as any).state;
  let next: string | null = null;
  if (cur !== "accepted") {
    if (isDelivery) next = "delivered";
    else if (senderRole === "hpd" && cur === "delivered") next = "in_revision";
  }
  await db.from("lab_work_orders").update({ ...(next ? { state: next } : {}), updated_at: new Date().toISOString() } as never).eq("id", params.id);
  return NextResponse.json({ message: msg });
}
