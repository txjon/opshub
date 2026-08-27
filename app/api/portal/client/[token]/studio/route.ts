import { NextRequest, NextResponse } from "next/server";
import { dbNoStore } from "@/lib/db-nostore";
import { isClientVisibleFile } from "@/lib/brief-visibility";
import { hubClientLookup } from "@/lib/hub-client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// THE CLIENT STUDIO feed (Phase 3 preview, Aug 4) — the Lab's client
// experience on real briefs, token-scoped. The wall is absolute: only
// client-visible art fronts cards, internal-only briefs never appear, and
// shelved/killed designs have left their view (working / with_client /
// approved are the whole client world).
const admin = dbNoStore;

export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  const db = admin();
  const { data: client } = await hubClientLookup(db, params.token, "id, name");
  if (!client) return NextResponse.json({ error: "Invalid link" }, { status: 404 });

  const { data: briefs } = await db.from("art_briefs")
    .select("id, title, state, source, created_at, updated_at")
    .eq("client_id", (client as any).id)
    .eq("internal_only", false)
    .is("client_aborted_at", null).is("deleted_at", null)
    .in("state", ["working", "with_client", "approved"])
    .order("updated_at", { ascending: false });
  const list = (briefs || []) as any[];

  // A design surfaces to the client once there's a reason to: they started it,
  // it's their move or banked, or we've shared something client-visible.
  const ids = list.map(b => b.id);
  const hasShared = new Set<string>();
  const artByBrief: Record<string, string> = {};
  if (ids.length) {
    const { data: files } = await db.from("art_brief_files")
      .select("brief_id, drive_file_id, preview_drive_file_id, uploader_role, shared_with_client_at, kind, reaction, created_at")
      .in("brief_id", ids).not("drive_file_id", "is", null)
      .order("created_at", { ascending: false });
    const artFallback: Record<string, string> = {};
    for (const f of (files || []) as any[]) {
      if (!isClientVisibleFile(f)) continue;
      hasShared.add(f.brief_id);
      if (!artByBrief[f.brief_id] && f.reaction !== "down") artByBrief[f.brief_id] = f.preview_drive_file_id || f.drive_file_id;
      if (!artFallback[f.brief_id]) artFallback[f.brief_id] = f.preview_drive_file_id || f.drive_file_id;
    }
    // A design whose ONLY version was thumbed down still shows its art —
    // a blank card reads as broken, not as "changes requested".
    for (const [bid, art] of Object.entries(artFallback)) if (!artByBrief[bid]) artByBrief[bid] = art;
    const { data: cm } = await db.from("art_brief_messages")
      .select("brief_id").in("brief_id", ids).eq("visibility", "client");
    for (const m of (cm || []) as any[]) hasShared.add(m.brief_id);
  }
  const releaseByBrief: Record<string, { title: string; status: string }> = {};
  if (ids.length) {
    const { data: rslots } = await db.from("release_slots").select("brief_id, releases!inner(title, status)").in("brief_id", ids);
    for (const r of (rslots || []) as any[]) {
      if (!r.brief_id) continue;
      const rel = { title: (r as any).releases?.title || "Release", status: (r as any).releases?.status || "" };
      const cur = releaseByBrief[r.brief_id];
      if (!cur || (cur.status === "cut" && rel.status !== "cut")) releaseByBrief[r.brief_id] = rel;
    }
  }

  // Live ballots (sent, un-minted) get the collage treatment: _lineup carries
  // up to 4 option thumbs + count; the first option also backfills _art.
  const lineupMeta: Record<string, { count: number; thumbs: string[] }> = {};
  if (ids.length) {
    const { data: lus } = await db.from("lineups").select("id, brief_id").in("brief_id", ids).not("sent_at", "is", null).is("closed_at", null);
    for (const lu of (lus || []) as any[]) {
      const { data: opts } = await db.from("lineup_options").select("preview_drive_file_id, drive_file_id, position").eq("lineup_id", lu.id).order("position");
      if (!(opts || []).length) continue;
      lineupMeta[lu.brief_id] = { count: (opts || []).length, thumbs: (opts || []).slice(0, 4).map((o: any) => o.preview_drive_file_id || o.drive_file_id) };
      if (!artByBrief[lu.brief_id]) artByBrief[lu.brief_id] = lineupMeta[lu.brief_id].thumbs[0];
      hasShared.add(lu.brief_id);
    }
  }
  const visible = list.filter(b => b.source === "client" || b.state === "with_client" || b.state === "approved" || hasShared.has(b.id));

  return NextResponse.json({
    client: { name: (client as any).name },
    briefs: visible.map(b => ({ id: b.id, title: b.title, state: b.state, _art: artByBrief[b.id] || null, _lineup: lineupMeta[b.id] || null, _release: releaseByBrief[b.id] || null })),
  });
}
