import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { getItemFolderId, uploadFile } from "@/lib/google-drive";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The client's verbs, social-style, on REAL briefs (the thumbs model live on
// the hub side). Thumbs act instantly; sheets carry the weight:
//   like  { fileId }                    → reaction 'up', no ball move
//   pass  { fileId, note? }             → reaction 'down' + state working
//   bank  { fileId }                    → approved + pin (the greenlight)
//   order { fileId, blank, qty, note? } → bank + an order request on the rail
//   shelve / kill                       → idea-level verdicts, leave their view
//   reply (multipart body/file)         → client message / upload, ball to us
// Every verb re-verifies token → client → brief ownership. Only HPD-shared
// files can be thumbed or banked — never the client's own uploads.
function admin() {
  return createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
}

export async function POST(req: NextRequest, { params }: { params: { token: string; briefId: string } }) {
  const db = admin();
  const { data: client } = await db.from("clients").select("id, name").eq("portal_token", params.token).single();
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });
  const clientId = (client as any).id;
  const name = (client as any).name || "Client";
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, state, client_id, internal_only")
    .eq("id", params.briefId).eq("client_id", clientId).eq("internal_only", false).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not your design" }, { status: 404 });
  const now = new Date().toISOString();

  const marker = (body: string) =>
    db.from("art_brief_messages").insert({ brief_id: params.briefId, sender_role: "client", sender_name: name, message: body, visibility: "client" } as never);
  async function hpdFile(fileId?: string) {
    if (!fileId) return null;
    const { data } = await db.from("art_brief_files")
      .select("id, drive_file_id, preview_drive_file_id")
      .eq("id", fileId).eq("brief_id", params.briefId)
      .neq("uploader_role", "client").not("shared_with_client_at", "is", null).maybeSingle();
    return data as any;
  }

  const ctype = req.headers.get("content-type") || "";

  // ── reply: multipart (note and/or photo) ──
  if (ctype.includes("multipart/form-data")) {
    const form = await req.formData();
    const body = String(form.get("body") || "").trim();
    const file = form.get("file") as File | null;
    if (!body && !file) return NextResponse.json({ error: "Say something or add a photo" }, { status: 400 });
    if (file && file.size > 0) {
      const folderId = await getItemFolderId(name, "Studio", (brief as any).title || "Design");
      const buffer = Buffer.from(await file.arrayBuffer());
      const up = await uploadFile(folderId, file.name || "photo.png", file.type || "image/png", buffer);
      await db.from("art_brief_files").insert({
        brief_id: params.briefId, file_name: file.name || "photo.png",
        drive_file_id: up.fileId, drive_link: up.webViewLink,
        mime_type: file.type || null, file_size: buffer.length,
        kind: "reference", uploader_role: "client", shared_with_client_at: now,
      } as never);
    }
    if (body) await db.from("art_brief_messages").insert({ brief_id: params.briefId, sender_role: "client", sender_name: name, message: body, visibility: "client" } as never);
    // A client word hands the ball back to us — an approved design is undisturbed.
    const patch: Record<string, any> = { updated_at: now };
    if (!["approved"].includes((brief as any).state)) patch.state = "working";
    await db.from("art_briefs").update(patch as never).eq("id", params.briefId);
    return NextResponse.json({ ok: true });
  }

  const b = await req.json().catch(() => ({}));

  if (b.action === "like") {
    const f = await hpdFile(b.fileId);
    if (!f) return NextResponse.json({ error: "Nothing to react to" }, { status: 400 });
    await db.from("art_brief_files").update({ reaction: "up" } as never).eq("id", f.id);
    await db.from("art_briefs").update({ updated_at: now } as never).eq("id", params.briefId);
    return NextResponse.json({ ok: true, state: (brief as any).state });
  }

  if (b.action === "pass") {
    const f = await hpdFile(b.fileId);
    if (!f) return NextResponse.json({ error: "Nothing to react to" }, { status: 400 });
    await db.from("art_brief_files").update({ reaction: "down" } as never).eq("id", f.id);
    if (b.note && String(b.note).trim()) await marker(String(b.note).trim());
    else await marker("Passed on this one.");
    await db.from("art_briefs").update({ state: "working", updated_at: now } as never).eq("id", params.briefId);
    return NextResponse.json({ ok: true, state: "working" });
  }

  if (b.action === "bank" || b.action === "order") {
    const f = await hpdFile(b.fileId);
    if (!f) return NextResponse.json({ error: "There's no design to keep yet" }, { status: 400 });
    await db.from("art_briefs").update({ state: "approved", approved_file_id: f.id, updated_at: now } as never).eq("id", params.briefId);
    await db.from("art_brief_files").update({ reaction: "up" } as never).eq("id", f.id);
    if (b.action === "bank") {
      await marker("✓ Banked this design.");
      return NextResponse.json({ ok: true, state: "approved" });
    }
    const blank = b.blank ? String(b.blank).trim() : null;
    const qty = Number.isFinite(Number(b.qty)) && Number(b.qty) > 0 ? Math.round(Number(b.qty)) : null;
    const note = b.note ? String(b.note).trim() : null;
    const { error: reqErr } = await db.from("lab_order_requests").insert({
      brief_id: params.briefId, thread_id: null,
      client_id: null,   // lab-client column; real identity rides on the brief
      design_file_url: `/api/files/thumbnail?id=${f.preview_drive_file_id || f.drive_file_id}&thumb=1&size=200`,
      blank, qty, note,
    } as never);
    if (reqErr) return NextResponse.json({ error: reqErr.message }, { status: 500 });
    await marker(`✓ Ordered this design: ${blank || "blank TBD"}${qty ? `, ${qty} pieces` : ""}.`);
    return NextResponse.json({ ok: true, state: "approved" });
  }

  if (b.action === "shelve" || b.action === "kill") {
    const killed = b.action === "kill";
    await db.from("art_briefs").update({ state: killed ? "killed" : "shelved", updated_at: now } as never).eq("id", params.briefId);
    await marker(killed ? "✕ Killed this idea." : "✓ Shelved for later.");
    return NextResponse.json({ ok: true, state: killed ? "killed" : "shelved" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
