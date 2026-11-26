// THE LINE SHEET — shared, client-safe model (mig 190, design map artifact
// 4931e236). A client-level product line: sections of named items with
// persistent identity, published versions, a client thumb per item and an
// optional client comment. New art on an item keeps a thumbs-up (a revision
// he asked for is still his pick) and resets a thumbs-down (he gets a fresh
// look at the rework); the comment stays, read as "on the previous version".
// replaces = the published picture this unpublished one swapped out (Replace);
// the client keeps seeing that until the next publish.
export type SheetImage = { id: string; driveId: string; name?: string | null; size?: number; replaces?: { driveId: string; name?: string | null } };
export type SheetItem = {
  id: string; sheet_id: string; section_id: string | null; name: string | null; sort: number;
  images: SheetImage[];
  added_in: number | null; updated_in: number | null;
  dropped: boolean; dropped_in: number | null;
  client_thumb: "up" | "down" | null; client_thumb_at: string | null; client_thumb_version: number | null;
  client_note: string | null;           // the client's comment, any thumb or none (mig 213)
  client_note_version: number | null;   // published version it was written on
  client_seen_version: number | null;   // last version the client looked at it on (mig 214)
};
export type SheetSection = { id: string; sheet_id: string; name: string; sort: number };
// Item numbers before the FIRST publish follow the shelves (Jon, Nov 2026):
// shelf order, then position on the shelf, then the tray. Nobody outside has
// seen a number yet, so they can track the layout; the first publish stamps
// them for good (route.ts publish) and from then on they never move.
export function shelfNumbering(
  sections: { id: string; sort: number }[],
  items: { id: string; section_id: string | null; sort: number; dropped?: boolean }[],
  includeTray = false,
): Record<string, number> {
  const live = items.filter(i => !i.dropped);
  // id breaks ties (legacy equal sorts) so builder and publish agree
  const bySort = (a: { id: string; sort: number }, b: { id: string; sort: number }) => ((a.sort || 0) - (b.sort || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const known = new Set(sections.map(s => s.id));
  const order = [...sections].sort(bySort).flatMap(sec => live.filter(i => i.section_id === sec.id).sort(bySort));
  if (includeTray) order.push(...live.filter(i => !i.section_id || !known.has(i.section_id)).sort(bySort));
  const out: Record<string, number> = {};
  order.forEach((it, k) => { out[it.id] = k + 1; });
  return out;
}

export type LineSheet = {
  id: string; client_id: string; release_id: string; title: string;
  status: "working" | "final"; current_version: number;
  created_by: string | null; created_at: string; updated_at: string;
};

// NEW / UPDATED badges on the published view: they last until the client has
// looked (mig 214: thumbed, commented or opened it full screen on that
// version or later), however many versions get published in between. v1
// pieces are never NEW: the whole sheet was new then.
export function badgeFor(item: Pick<SheetItem, "added_in" | "updated_in" | "client_seen_version">): "new" | "updated" | null {
  const seen = item.client_seen_version ?? 0;
  if (item.added_in != null && item.added_in > 1 && seen < item.added_in) return "new";
  if (item.updated_in != null && item.updated_in !== item.added_in && seen < item.updated_in) return "updated";
  return null;
}

// A comment written before the item's latest new art is about the old picture.
export function noteIsStale(it: { client_note?: string | null; client_note_version?: number | null; updated_in?: number | null }): boolean {
  return !!it.client_note && it.updated_in != null && it.client_note_version != null && it.updated_in > it.client_note_version;
}

export const newImageId = () => Math.random().toString(36).slice(2, 9);

// ── THE CLIENT VIEW (Jon, Oct 1 2026: "publishing should only be for new
// uploads, not organizing") ────────────────────────────────────────────────
// Organizing is LIVE: names, shelves, order, grouping, drops show the moment
// they're saved. Only NEW ART waits for a publish: an item is visible once it
// has been published (added_in set), and an image only once it appeared in a
// published snapshot, so a new upload grouped onto a live item stays hidden
// until the next publish. One function, read by the hub sheet AND the
// Releases hero, so the two can never disagree.
type Db = any;
export async function publishedImageIds(db: Db, sheetId: string): Promise<Set<string>> {
  const { data } = await db.from("line_sheet_versions").select("snapshot").eq("sheet_id", sheetId);
  const ids = new Set<string>();
  for (const v of (data || []) as any[]) for (const it of v.snapshot?.items || []) for (const img of it.images || []) ids.add(img.driveId);
  return ids;
}

export async function clientSheetView(db: Db, sheet: { id: string; current_version: number }) {
  const n = sheet.current_version;
  const [{ data: secs }, { data: rows }, { data: v }, published] = await Promise.all([
    db.from("line_sheet_sections").select("id, name, sort").eq("sheet_id", sheet.id).order("sort"),
    db.from("line_sheet_items").select("id, section_id, name, item_no, sort, images, added_in, updated_in, dropped, client_thumb, client_note, client_note_version, client_seen_version").eq("sheet_id", sheet.id).order("sort"),
    db.from("line_sheet_versions").select("n, note, published_at").eq("sheet_id", sheet.id).eq("n", n).maybeSingle(),
    publishedImageIds(db, sheet.id),
  ]);
  const items = ((rows || []) as any[])
    .filter(it => !it.dropped && it.added_in != null)
    .map(it => ({ ...it, images: (it.images || []).map((img: SheetImage) => published.has(img.driveId) ? img
      : img.replaces && published.has(img.replaces.driveId) ? { id: img.id, driveId: img.replaces.driveId, name: img.replaces.name } : null).filter(Boolean) }))
    .filter(it => it.images.length > 0)
    .map(it => ({
      id: it.id, section_id: it.section_id, name: it.name, item_no: it.item_no, sort: it.sort, images: it.images,
      badge: badgeFor(it), thumb: it.client_thumb ?? null, note: it.client_note ?? null,
      noteStale: noteIsStale(it),
    }));
  return {
    version: { n, note: (v as any)?.note || null, published_at: (v as any)?.published_at || null },
    sections: ((secs || []) as any[]).map(s => ({ id: s.id, name: s.name, sort: s.sort })),
    items,
  };
}
