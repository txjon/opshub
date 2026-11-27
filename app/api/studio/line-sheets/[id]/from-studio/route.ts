import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { verdictPatch } from "@/lib/line-sheets";
import { studioRequests, cardFrom } from "@/lib/studio-import";
import { removeBriefFile } from "@/lib/brief-files-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The Studio clean-up → board (lib/studio-import).
// GET  → { requests } every file on every request of this board's client
// POST → { board: fileIds, trash: fileIds } one pass: board files become one
//        draft card per request and leave Studio; trash files leave Studio
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function load(id: string) {
  const supabase = await createClient();
  if (!(await studioUser(supabase))) return { error: NextResponse.json({ error: "Sign in" }, { status: 401 }) };
  const db = admin();
  if (!(await lineSheetInCompany(db, id))) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const { data: sheet } = await db.from("line_sheets").select("id, client_id, current_version, archived_at").eq("id", id).maybeSingle();
  if (!sheet) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const { data: items } = await db.from("line_sheet_items").select("images, sort").eq("sheet_id", id);
  const onBoard = new Set<string>();
  for (const it of (items || []) as any[]) for (const img of it.images || []) { onBoard.add(img.driveId); if (img.replaces?.driveId) onBoard.add(img.replaces.driveId); }
  return { db, sheet: sheet as any, items: (items || []) as any[], onBoard };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const r = await load(params.id);
  if ("error" in r) return r.error;
  return NextResponse.json({ requests: await studioRequests(r.db, r.sheet.client_id, r.onBoard) });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const r = await load(params.id);
  if ("error" in r) return r.error;
  const { db, sheet, items, onBoard } = r;
  if (sheet.archived_at) return NextResponse.json({ error: "Unarchive the sheet first" }, { status: 409 });
  const b = await req.json().catch(() => ({} as any));
  const toBoard = new Set<string>(Array.isArray(b.board) ? b.board.map(String) : []);
  const toTrash = new Set<string>(Array.isArray(b.trash) ? b.trash.map(String) : []);
  // re-read here: only this client's files count, whatever the page sent
  const reqs = await studioRequests(db, sheet.client_id, onBoard);
  const mine = new Map(reqs.flatMap(q => q.files.map(f => [f.id, f] as const)));
  for (const id of toBoard) if (!mine.get(id)?.driveId) toBoard.delete(id);   // no picture → can't go on the board
  for (const id of toTrash) if (!mine.has(id) || toBoard.has(id)) toTrash.delete(id);
  if (!toBoard.size && !toTrash.size) return NextResponse.json({ error: "Nothing picked" }, { status: 400 });

  // 1. the cards, before anything leaves Studio: a failed insert loses nothing
  const cards = reqs.map(q => ({ q, card: cardFrom(q, toBoard) })).filter(x => x.card);
  if (cards.length) {
    // like an upload: on a live sheet above everything (where HPD sees them),
    // before the first publish after everything
    const live = (sheet.current_version || 0) > 0;
    const sorts = items.map(i => Number(i.sort) || 0);
    const edge = sorts.length ? (live ? Math.min(...sorts) : Math.max(...sorts)) : 0;
    const rows = cards.map(({ q, card }, k) => ({
      sheet_id: sheet.id, name: card!.name, images: card!.images,
      sort: live ? edge - cards.length + k : edge + 1 + k,
      // the client approved THIS art in Studio (the banked version is on the card)
      ...(q.approvedFileId && toBoard.has(q.approvedFileId) ? verdictPatch("asis", "client", sheet.current_version || 0) : {}),
      ...(q.clientNote ? { client_note: q.clientNote, client_note_version: sheet.current_version || 0 } : {}),
    }));
    const { error } = await db.from("line_sheet_items").insert(rows as never);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", sheet.id);
  }
  // 2. out of Studio: board files keep their Drive file (the board uses it),
  // trashed ones go to Drive's trash when nothing else uses them
  const failed: string[] = [];
  // a PSD stays: only its flat preview went to the board, and the layered
  // file is the print file
  for (const id of toBoard) if (!mine.get(id)!.layered && await removeBriefFile(db, id, { trash: false })) failed.push(id);
  for (const id of toTrash) if (await removeBriefFile(db, id, { trash: true })) failed.push(id);
  return NextResponse.json({ ok: true, cards: cards.length, moved: toBoard.size, trashed: toTrash.size, failed: failed.length });
}
