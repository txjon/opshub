import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createClient as createAdmin } from "@supabase/supabase-js";
import { visualKey } from "@/lib/line-sheets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// One line sheet.
// GET    → sheet + sections + items (live draft) + version history.
// PATCH  → { title?, season? } meta edits
//          { publish: true, note? } → stamp the next version (see below)
//          { finalize: true } / { reopen: true } → status
// DELETE → remove the sheet outright (confirmed in UI; drafts and dead ends).
const admin = () => createAdmin(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", user.id).single();
  return { user, name: (profile as any)?.full_name || user.email || "HPD" };
}
async function loadFull(db: any, id: string) {
  const { data: sheet } = await db.from("line_sheets").select("*, clients(id, name, portal_token)").eq("id", id).maybeSingle();
  if (!sheet) return null;
  const [{ data: sections }, { data: items }, { data: versions }] = await Promise.all([
    db.from("line_sheet_sections").select("*").eq("sheet_id", id).order("sort"),
    db.from("line_sheet_items").select("*").eq("sheet_id", id).order("sort"),
    db.from("line_sheet_versions").select("id, n, note, published_at, published_by").eq("sheet_id", id).order("n"),
  ]);
  return { sheet, sections: sections || [], items: items || [], versions: versions || [] };
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const full = await loadFull(admin(), params.id);
  if (!full) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(full);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const who = await me();
  if (!who) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const b = await req.json().catch(() => ({} as any));
  const db = admin();
  const { data: sheet } = await db.from("line_sheets").select("*").eq("id", params.id).maybeSingle();
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const now = new Date().toISOString();

  // ── PUBLISH: the draft becomes v(n+1) the client can see ──────────────────
  if (b.publish) {
    const n = ((sheet as any).current_version || 0) + 1;
    const { data: items } = await db.from("line_sheet_items").select("*").eq("sheet_id", params.id).order("sort");
    const { data: sections } = await db.from("line_sheet_sections").select("*").eq("sheet_id", params.id).order("sort");
    // last snapshot's visual fingerprints — the carry rule's baseline
    const { data: lastV } = await db.from("line_sheet_versions").select("snapshot").eq("sheet_id", params.id).eq("n", n - 1).maybeSingle();
    const lastKeys: Record<string, string> = {};
    for (const it of ((lastV as any)?.snapshot?.items || [])) lastKeys[it.id] = visualKey(it.images);
    let added = 0, updated = 0, droppedN = 0;
    for (const it of (items || []) as any[]) {
      const patch: Record<string, any> = {};
      if (it.dropped && it.dropped_in == null) { patch.dropped_in = n; droppedN++; }
      if (!it.dropped) {
        if (it.added_in == null) { patch.added_in = n; added++; }
        else if (lastKeys[it.id] != null && lastKeys[it.id] !== visualKey(it.images)) {
          // visually changed → UPDATED badge, and the thumb resets: the
          // client is judging a new picture (the carry rule).
          patch.updated_in = n;
          patch.client_thumb = null; patch.client_thumb_at = null; patch.client_thumb_version = null;
          updated++;
        }
      }
      if (Object.keys(patch).length) await db.from("line_sheet_items").update(patch as never).eq("id", it.id);
    }
    const { data: fresh } = await db.from("line_sheet_items").select("*").eq("sheet_id", params.id).order("sort");
    const snapshot = {
      sections: (sections || []).map((s: any) => ({ id: s.id, name: s.name, sort: s.sort })),
      items: ((fresh || []) as any[]).filter(i => !i.dropped).map(i => ({
        id: i.id, section_id: i.section_id, name: i.name, sort: i.sort, images: i.images,
        added_in: i.added_in, updated_in: i.updated_in,
      })),
    };
    const { error: vErr } = await db.from("line_sheet_versions").insert({ sheet_id: params.id, n, note: b.note ? String(b.note).trim() : null, snapshot, published_by: who.name } as never);
    if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    await db.from("line_sheets").update({ current_version: n, updated_at: now } as never).eq("id", params.id);
    // First publish grants the hub tab — the sheet IS the share.
    try {
      const { data: cl } = await db.from("clients").select("portal_features").eq("id", (sheet as any).client_id).single();
      const feats: string[] = Array.isArray((cl as any)?.portal_features) ? (cl as any).portal_features : [];
      if (!feats.includes("linesheets")) await db.from("clients").update({ portal_features: [...feats, "linesheets"] } as never).eq("id", (sheet as any).client_id);
    } catch {}
    return NextResponse.json({ ok: true, n, added, updated, dropped: droppedN });
  }

  if (b.finalize || b.reopen) {
    await db.from("line_sheets").update({ status: b.finalize ? "final" : "working", updated_at: now } as never).eq("id", params.id);
    return NextResponse.json({ ok: true });
  }
  const patch: Record<string, any> = { updated_at: now };
  if (b.title !== undefined) patch.title = String(b.title || "").trim().slice(0, 140) || (sheet as any).title;
  if (b.season !== undefined) patch.season = b.season ? String(b.season).trim().slice(0, 60) : null;
  const { error } = await db.from("line_sheets").update(patch as never).eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await me())) return NextResponse.json({ error: "Sign in" }, { status: 401 });
  const { error } = await admin().from("line_sheets").delete().eq("id", params.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
