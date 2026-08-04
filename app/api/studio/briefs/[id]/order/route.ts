import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dbNoStore } from "@/lib/db-nostore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Order ON THE CLIENT'S WORD (internal) — the out-of-band door. Client texts
// "I want this" about a banked design: the team captures the ask here, it
// lands on the rail like any client-made request, Start the job bridges it.
// Logged with who took it; the brief must already be approved (the bank).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  const byName = (profile as any)?.full_name || user.email || "HPD";

  const db = dbNoStore();
  const { data: brief } = await db.from("art_briefs")
    .select("id, title, state, approved_file_id").eq("id", params.id).maybeSingle();
  if (!brief) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if ((brief as any).state !== "approved") {
    return NextResponse.json({ error: "Only banked designs order on their word. Bank it first (or have them thumb it up)." }, { status: 409 });
  }

  const b = await req.json().catch(() => ({}));
  const blank = b.blank ? String(b.blank).trim() : null;
  const qty = Number.isFinite(Number(b.qty)) && Number(b.qty) > 0 ? Math.round(Number(b.qty)) : null;
  const note = b.note ? String(b.note).trim() : null;

  // The card's face: the pinned design, else the newest client-visible file.
  let faceId: string | null = null;
  if ((brief as any).approved_file_id) {
    const { data: pin } = await db.from("art_brief_files").select("preview_drive_file_id, drive_file_id").eq("id", (brief as any).approved_file_id).maybeSingle();
    faceId = (pin as any)?.preview_drive_file_id || (pin as any)?.drive_file_id || null;
  }
  if (!faceId) {
    const { data: newest } = await db.from("art_brief_files")
      .select("preview_drive_file_id, drive_file_id").eq("brief_id", params.id).not("drive_file_id", "is", null)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    faceId = (newest as any)?.preview_drive_file_id || (newest as any)?.drive_file_id || null;
  }

  const { data: reqRow, error } = await db.from("lab_order_requests").insert({
    brief_id: params.id, thread_id: null, client_id: null,
    design_file_url: faceId ? `/api/files/thumbnail?id=${faceId}&thumb=1&size=200` : null,
    blank, qty, note,
  } as never).select("id").single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await db.from("art_brief_messages").insert({
    brief_id: params.id, sender_role: "hpd", sender_name: byName,
    message: `✓ Order taken on the client's word: ${blank || "blank TBD"}${qty ? `, ${qty} pieces` : ""}${note ? ` · "${note}"` : ""}.`,
    visibility: "internal",
  } as never);

  return NextResponse.json({ ok: true, requestId: (reqRow as any).id });
}
