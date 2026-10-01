import { NextRequest, NextResponse } from "next/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { hubClientLookup } from "@/lib/hub-client";
import { badgeFor } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A release's line sheet, the client's view (mig 192: the sheet is the
// proposal stage of ONE release). Rides the 'releases' grant.
// GET  → the LATEST PUBLISHED snapshot (drafts invisible) + live thumbs.
// POST → { itemId, thumb: "up" | "down" | null } — the one-tap reaction. It
//        rides the ITEM across versions (the carry rule); tapping the same
//        thumb again clears it.
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function sheetFor(db: any, token: string, releaseId: string) {
  const { data: client } = await hubClientLookup(db, token, "id, name, portal_features");
  if (!client) return null;
  if (!Array.isArray((client as any).portal_features) || !(client as any).portal_features.includes("releases")) return null;
  const { data: sheet } = await db.from("line_sheets").select("*, releases!inner(id, title)").eq("release_id", releaseId).eq("client_id", (client as any).id).gt("current_version", 0).maybeSingle();
  return sheet ? { client, sheet } : null;
}

export async function GET(_req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token, params.releaseId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  const n = sheet.current_version;
  const { data: v } = await db.from("line_sheet_versions").select("n, note, snapshot, published_at").eq("sheet_id", sheet.id).eq("n", n).single();
  // live thumbs overlay the frozen layout
  const { data: live } = await db.from("line_sheet_items").select("id, client_thumb").eq("sheet_id", sheet.id);
  const thumbs: Record<string, string | null> = {};
  for (const it of (live || []) as any[]) thumbs[it.id] = it.client_thumb;
  const snap: any = (v as any)?.snapshot || { sections: [], items: [] };
  const items = (snap.items || []).map((it: any) => ({ ...it, badge: badgeFor(it, n), thumb: thumbs[it.id] ?? null }));
  return NextResponse.json({
    sheet: { id: sheet.id, title: sheet.title, season: sheet.season, status: sheet.status },
    release: { id: sheet.releases.id, title: sheet.releases.title },
    version: { n, note: (v as any)?.note || null, published_at: (v as any)?.published_at },
    sections: snap.sections || [], items,
  });
}

export async function POST(req: NextRequest, { params }: { params: { token: string; releaseId: string } }) {
  const db = admin();
  const ctx = await sheetFor(db, params.token, params.releaseId);
  if (!ctx) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { sheet } = ctx as any;
  const b = await req.json().catch(() => ({} as any));
  if (!b.itemId || !["up", "down", null].includes(b.thumb ?? null)) return NextResponse.json({ error: "Bad reaction" }, { status: 400 });
  const { data: item } = await db.from("line_sheet_items").select("id, dropped").eq("id", b.itemId).eq("sheet_id", sheet.id).maybeSingle();
  if (!item || (item as any).dropped) return NextResponse.json({ error: "Not on the sheet" }, { status: 404 });
  const { error } = await db.from("line_sheet_items").update({
    client_thumb: b.thumb ?? null,
    client_thumb_at: b.thumb ? new Date().toISOString() : null,
    client_thumb_version: b.thumb ? sheet.current_version : null,
  } as never).eq("id", b.itemId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, thumb: b.thumb ?? null });
}
