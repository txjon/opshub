import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";
import { clientSheetView, clientBoard, verdictPatch, SETTABLE_VERDICTS, noteIsStale } from "@/lib/line-sheets";
import { createClient as createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE CLIENT'S LINE SHEET — his board (Jon, Nov 26 2026: one running board
// per client; it feeds releases through "Add to release", mig 217). Its own
// hub tab, no longer reached only through a release. Rides the 'releases'
// grant (the first publish grants it). One board per client: the newest
// published, unarchived sheet.
// GET  → the client view: organizing live, art only once published.
// POST → { itemId, verdict: "asis" | "change" | "pass" | null, note? } — his
//        verdict (mig 215); null = undo, back to Concepts. "change" needs a
//        note saying what should change (sent with it, or already on the
//        current picture). Or
// POST → { itemId, note } = his note on its own (a "+ note" on As is / Pass,
//        or editing what he asked for); empty clears it, except on a Change,
//        which keeps its note. Or
// POST → { itemId, seen: true } = he opened it full screen.
// Every client action stamps client_seen_version (mig 214), which retires
// the item's NEW / UPDATED badge. HPD staff opening the client link (signed
// into OpsHub in the same browser) never count as the client looking.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function sheetFor(db: any, token: string) {
  const { data: client } = await hubClientLookup(db, token, "id, name, portal_features");
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases")) return null;
  const sheet = await clientBoard(db, (client as any).id);
  return sheet ? { client, sheet } : null;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  // Live organizing + published art only (lib/line-sheets clientSheetView).
  const view = await clientSheetView(db, sheet);
  return NextResponse.json({
    sheet: { id: sheet.id, title: sheet.title, status: sheet.status },
    version: view.version,
    items: view.items,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  const b = await req.json().catch(() => ({} as any));
  const { data: item } = await db.from("line_sheet_items").select("id, dropped, added_in, updated_in, client_verdict, client_note, client_note_version").eq("id", b.itemId || "").eq("sheet_id", sheet.id).maybeSingle();
  if (!item || (item as any).dropped || (item as any).added_in == null) return NextResponse.json({ error: "Not on the sheet" }, { status: 404 });
  // staff previewing the client's link: actions still save (they're testing
  // or acting for the client), but a look alone never retires a badge
  let staff = false;
  try { const { data: { user } } = await (await createServerClient()).auth.getUser(); staff = !!user; } catch { staff = false; }
  const by = staff ? "hpd" as const : "client" as const;
  // the version the client actually had loaded, so a publish landing while
  // their page is open never retires the new version's badges unseen
  const loaded = Number(b.version);
  const seen = staff ? {} : { client_seen_version: Number.isInteger(loaded) && loaded > 0 ? Math.min(loaded, sheet.current_version) : sheet.current_version };
  const cleanNote = (raw: any) => String(raw || "").replace(/\s*\n\s*/g, " ").trim().slice(0, 500) || null;
  const save = async (patch: Record<string, any>) => {
    const { error } = await db.from("line_sheet_items").update({ ...patch, ...seen } as never).eq("id", b.itemId);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    // the board's "client updated" stamp (mig 219): his answers and notes only
    if (!staff && Object.keys(patch).length) await db.from("line_sheets").update({ client_updated_at: new Date().toISOString() } as never).eq("id", sheet.id);
    return null;
  };
  if (b.seen === true && b.verdict === undefined && b.note === undefined) {
    if (staff) return NextResponse.json({ ok: true, staff: true });
    return (await save({})) || NextResponse.json({ ok: true });
  }
  if (b.verdict === undefined && b.note !== undefined) {
    const note = cleanNote(b.note);
    // a Change is only ever as good as its note: an empty one keeps the old
    if (!note && (item as any).client_verdict === "change") return NextResponse.json({ error: "Say what should change, or tap Change again to undo" }, { status: 400 });
    return (await save({ client_note: note, client_note_version: note ? sheet.current_version : null })) || NextResponse.json({ ok: true, note });
  }
  const v = b.verdict ?? null;
  if (v !== null && !(SETTABLE_VERDICTS as readonly string[]).includes(v)) return NextResponse.json({ error: "Bad verdict" }, { status: 400 });
  const note = b.note !== undefined ? cleanNote(b.note) : undefined;
  if (v === "change") {
    // what he asked for must be about THIS picture: a fresh note, or one he
    // already wrote on it (not the one on the art it replaced)
    const hasCurrent = !!(item as any).client_note && !noteIsStale(item as any);
    if (!note && !hasCurrent) return NextResponse.json({ error: "Say what should change" }, { status: 400 });
  }
  const notePatch = note ? { client_note: note, client_note_version: sheet.current_version } : {};
  return (await save({ ...verdictPatch(v, by, sheet.current_version), ...notePatch })) || NextResponse.json({ ok: true, verdict: v });
}
