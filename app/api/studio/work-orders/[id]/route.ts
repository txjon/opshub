import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { woDb, loadWorkOrder } from "@/lib/design-work-orders-server";
import { logJobActivityServer } from "@/lib/notify-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One work order (studio side).
// GET   → the order + its whole thread (files decorated with Drive ids).
// PATCH → { action: "seen" }   we opened it (clears the unread clock)
//         { action: "accept" } lock the latest delivery as THE file
//         { action: "kill" }   pull the order (link dies); { action: "reopen" }
//         { headline?, instructions?, dueBy?, brief? } edit the live brief —
//         the designer's page reads the same row, so an edit is instantly theirs.
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const r = await loadWorkOrder(params.id);
  if (!r) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const url = `${_req.nextUrl.origin}/designer/${r.wo.token}`;
  return NextResponse.json({ workOrder: r.wo, messages: r.messages.map(decorate), url });
}

// Our side renders through the internal proxy; the download is the original.
function decorate(m: any) {
  const img = m._preview || m._drive;
  return {
    ...m,
    image_url: img ? `/api/files/thumbnail?id=${img}&thumb=1&size=900` : (m.file_url || null),
    download_url: m._drive ? `/api/files/view/${encodeURIComponent(m.file_name || "file")}?id=${m._drive}&download=1` : (m.file_url || null),
  };
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const db = woDb();
  const { data: wo } = await db.from("design_work_orders").select("id, brief_id, item_id, job_id, state, title").eq("id", params.id).maybeSingle();
  if (!wo) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date().toISOString();

  if (b.action === "seen") {
    await db.from("design_work_orders").update({ hpd_seen_at: now } as never).eq("id", params.id);
    return NextResponse.json({ ok: true });
  }
  if (b.action === "accept") {
    const { data: last } = await db.from("design_wo_messages").select("file_id, item_file_id, file_name")
      .eq("work_order_id", params.id).eq("sender_role", "designer").eq("kind", "delivery").or("file_id.not.is.null,item_file_id.not.is.null").order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!last) return NextResponse.json({ error: "No delivery to accept yet" }, { status: 400 });
    const itemFileId = (last as any).item_file_id || null;
    await db.from("design_work_orders").update({ state: "accepted", accepted_file_id: (last as any).file_id || null, accepted_item_file_id: itemFileId, updated_at: now, last_hpd_at: now, hpd_seen_at: now } as never).eq("id", params.id);
    await db.from("design_wo_messages").insert({ work_order_id: params.id, sender_role: "hpd", sender_name: who.name, body: "✓ Accepted — this is the file.", kind: "accept" } as never);
    if ((wo as any).brief_id) {
      await db.from("art_brief_messages").insert({ brief_id: (wo as any).brief_id, sender_role: "hpd", sender_name: who.name, message: `✓ Designer file accepted${(last as any).file_name ? ` — ${(last as any).file_name}` : ""}.`, visibility: "internal" } as never);
      await db.from("art_briefs").update({ updated_at: now } as never).eq("id", (wo as any).brief_id);
    }
    // On a run: the accepted delivery IS the item's print-ready file → the PO.
    if (itemFileId) {
      await db.from("item_files").update({ stage: "print_ready", approval: "none" } as never).eq("id", itemFileId);
      if ((wo as any).job_id) await logJobActivityServer((wo as any).job_id, `${(wo as any).title || "Item"}: designer file accepted as print-ready${(last as any).file_name ? ` — ${(last as any).file_name}` : ""}.`, { work_order_id: params.id, item_file_id: itemFileId });
    }
    return NextResponse.json({ ok: true, state: "accepted" });
  }
  if (b.action === "kill" || b.action === "reopen") {
    const state = b.action === "kill" ? "killed" : "out";
    await db.from("design_work_orders").update({ state, updated_at: now, hpd_seen_at: now } as never).eq("id", params.id);
    await db.from("design_wo_messages").insert({ work_order_id: params.id, sender_role: "hpd", sender_name: who.name, body: state === "killed" ? "✕ Order pulled." : "↩ Order reopened.", kind: "comment" } as never);
    return NextResponse.json({ ok: true, state });
  }
  // live brief edits
  const patch: Record<string, any> = { updated_at: now };
  if (b.headline !== undefined) patch.headline = b.headline ? String(b.headline).trim().slice(0, 140) : null;
  if (b.instructions !== undefined) patch.instructions = b.instructions ? String(b.instructions).trim() : null;
  if (b.dueBy !== undefined) patch.due_by = b.dueBy || null;
  if (b.brief && typeof b.brief === "object") patch.brief = { canvases: Array.isArray(b.brief.canvases) ? b.brief.canvases : [], extras: Array.isArray(b.brief.extras) ? b.brief.extras : [], conversation: (Array.isArray(b.brief.conversation) ? b.brief.conversation : []).map((l: any) => ({ role: l?.role === "client" ? "client" : "us", text: String(l?.text || "").trim().slice(0, 2000), at: l?.at || null })).filter((l: any) => l.text) };
  if (b.designerName !== undefined) patch.designer_name = b.designerName ? String(b.designerName).trim() : null;
  if (b.designerEmail !== undefined) patch.designer_email = b.designerEmail ? String(b.designerEmail).trim().toLowerCase() : null;
  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
  const { error } = await db.from("design_work_orders").update(patch as never).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { error } = await woDb().from("design_work_orders").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
