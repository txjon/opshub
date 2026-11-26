import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";
import { clientSheetView } from "@/lib/line-sheets";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A release's line sheet, the client's view (mig 192: the sheet is the
// proposal stage of ONE release). Rides the 'releases' grant.
// GET  → the client view: organizing live, art only once published.
// POST → { itemId, note } = the client's comment on an item (mig 213): any
//        time, with or without a thumb; empty clears it. Or
// POST → { itemId, thumb: "up" | "down" | null } — the one-tap reaction,
//        null = Clear (back to its shelf). The comment is untouched by it. Or
// POST → { itemId, seen: true } = he opened it full screen.
// Every client reaction stamps client_seen_version (mig 214), which retires
// the item's NEW / UPDATED badge. HPD staff opening the client link (signed
// into OpsHub in the same browser) never count as the client looking.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function sheetFor(db: any, token: string, releaseId: string) {
  const { data: client } = await hubClientLookup(db, token, "id, name, portal_features");
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases")) return null;
  const { data: sheet } = await db.from("line_sheets").select("*, releases!inner(id, title)").eq("release_id", releaseId).eq("client_id", (client as any).id).gt("current_version", 0).is("archived_at", null).maybeSingle();
  return sheet ? { client, sheet } : null;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token, params.releaseId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  // Live organizing + published art only (lib/line-sheets clientSheetView).
  const view = await clientSheetView(db, sheet);
  return NextResponse.json({
    sheet: { id: sheet.id, title: sheet.title, status: sheet.status },
    release: { id: sheet.releases.id, title: sheet.releases.title },
    version: view.version,
    sections: view.sections, items: view.items,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token, params.releaseId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  const b = await req.json().catch(() => ({} as any));
  const { data: item } = await db.from("line_sheet_items").select("id, dropped, added_in, client_thumb").eq("id", b.itemId || "").eq("sheet_id", sheet.id).maybeSingle();
  if (!item || (item as any).dropped || (item as any).added_in == null) return NextResponse.json({ error: "Not on the sheet" }, { status: 404 });
  // staff previewing the client's link: reactions still save (they're testing
  // or acting for the client), but a look alone never retires a badge
  let staff = false;
  try { const { data: { user } } = await (await createServerClient()).auth.getUser(); staff = !!user; } catch { staff = false; }
  const seen = { client_seen_version: sheet.current_version };
  if (b.seen === true && b.thumb === undefined && b.note === undefined) {
    if (staff) return NextResponse.json({ ok: true, staff: true });
    const { error } = await db.from("line_sheet_items").update(seen as never).eq("id", b.itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }
  if (b.thumb === undefined && b.note !== undefined) {
    const note = String(b.note || "").trim().slice(0, 500) || null;
    const { error } = await db.from("line_sheet_items").update({ client_note: note, client_note_version: note ? sheet.current_version : null, ...(staff ? {} : seen) } as never).eq("id", b.itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, note });
  }
  if (!["up", "down", null].includes(b.thumb ?? null)) return NextResponse.json({ error: "Bad reaction" }, { status: 400 });
  const { error } = await db.from("line_sheet_items").update({
    client_thumb: b.thumb ?? null,
    client_thumb_at: b.thumb ? new Date().toISOString() : null,
    client_thumb_version: b.thumb ? sheet.current_version : null,
    ...(staff ? {} : seen),
  } as never).eq("id", b.itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, thumb: b.thumb ?? null });
}
