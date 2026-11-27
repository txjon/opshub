import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { studioUser, lineSheetInCompany } from "@/lib/studio-access";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { verdictPatch } from "@/lib/line-sheets";
import { studioRequests } from "@/lib/studio-import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The one-time Studio → board move (lib/studio-import).
// GET  → { requests } this client's old Studio requests that have art
// POST → { briefIds } each becomes one draft card on this board
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
  const want = new Set<string>(Array.isArray(b.briefIds) ? b.briefIds.map(String) : []);
  // re-read here: only this client's requests, and never the same art twice
  const picked = (await studioRequests(db, sheet.client_id, onBoard)).filter(q => want.has(q.id) && !q.onBoard);
  if (!picked.length) return NextResponse.json({ error: "Nothing new to bring in" }, { status: 400 });
  // like an upload: on a live sheet above everything (where HPD sees them),
  // before the first publish after everything
  const live = (sheet.current_version || 0) > 0;
  const sorts = items.map(i => Number(i.sort) || 0);
  const edge = sorts.length ? (live ? Math.min(...sorts) : Math.max(...sorts)) : 0;
  const rows = picked.map((q, k) => ({
    sheet_id: sheet.id, name: q.title, images: q.images,
    sort: live ? edge - picked.length + k : edge + 1 + k,
    // the client approved this art in Studio
    ...(q.state === "approved" ? verdictPatch("asis", "client", sheet.current_version || 0) : {}),
    ...(q.clientNote ? { client_note: q.clientNote, client_note_version: sheet.current_version || 0 } : {}),
  }));
  const { error } = await db.from("line_sheet_items").insert(rows as never);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await db.from("line_sheets").update({ updated_at: new Date().toISOString() } as never).eq("id", sheet.id);
  return NextResponse.json({ ok: true, added: rows.length });
}
