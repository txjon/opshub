import { NextRequest, NextResponse } from "next/server";
import { woDb, fileDesignerDelivery, pingLabsAboutDesigner } from "@/lib/design-work-orders-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The designer's send: { body?, storagePath?, fileName?, mimeType?, senderName? }.
// A file = a DELIVERY (state → delivered) and gets filed into Drive + the
// design's files; words alone = a reply. Either way labs@ gets the ping with
// the exact link, and the desk shows it unread until we open it.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const b = await req.json().catch(() => ({} as any));
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("*, art_briefs(id, title, clients(name))").eq("token", params.token).maybeSingle();
  if (!wo || (wo as any).state === "killed") return NextResponse.json({ error: "This link isn't live" }, { status: 404 });
  if ((wo as any).state === "accepted") return NextResponse.json({ error: "This order is closed — the file was accepted" }, { status: 409 });
  const body = b.body ? String(b.body).trim() : "";
  const storagePath = b.storagePath ? String(b.storagePath) : "";
  if (!body && !storagePath) return NextResponse.json({ error: "Say something or attach the file" }, { status: 400 });
  if (storagePath && !storagePath.startsWith(`wo/${(wo as any).id}/`)) return NextResponse.json({ error: "Not your upload" }, { status: 403 });

  const senderName = (b.senderName && String(b.senderName).trim()) || (wo as any).designer_name || "Designer";
  let fileRowId: string | null = null; let fileUrl: string | null = null;
  const fileName = String(b.fileName || "delivery");
  if (storagePath) {
    const filed = await fileDesignerDelivery({
      briefId: (wo as any).brief_id, clientName: (wo as any).art_briefs?.clients?.name || "Studio",
      designTitle: (wo as any).art_briefs?.title || (wo as any).title || "Design",
      storagePath, fileName, mimeType: b.mimeType || "application/octet-stream",
    });
    fileRowId = filed.fileRowId; fileUrl = filed.publicUrl;
  }
  const isDelivery = !!storagePath;
  const { data: msg, error } = await db.from("design_wo_messages").insert({
    work_order_id: (wo as any).id, sender_role: "designer", sender_name: senderName, body: body || null,
    file_id: fileRowId, file_url: fileUrl, file_name: storagePath ? fileName : null, kind: isDelivery ? "delivery" : "comment",
  } as never).select("*").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const now = new Date().toISOString();
  await db.from("design_work_orders").update({
    ...(isDelivery ? { state: "delivered" } : {}), last_designer_at: now, updated_at: now,
    ...(b.senderName && !(wo as any).designer_name ? { designer_name: senderName } : {}),
  } as never).eq("id", (wo as any).id);
  await db.from("art_briefs").update({ updated_at: now } as never).eq("id", (wo as any).brief_id);
  await pingLabsAboutDesigner(isDelivery ? "designer_delivery" : "designer_reply", { ...(wo as any), designer_name: senderName }, body || null);
  return NextResponse.json({ message: msg, state: isDelivery ? "delivered" : (wo as any).state });
}
