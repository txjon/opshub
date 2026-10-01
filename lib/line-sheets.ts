// THE LINE SHEET — shared, client-safe model (mig 190, design map artifact
// 4931e236). A client-level product line: sections of named items with
// persistent identity, published versions, and a client thumb per item that
// carries across versions until the item visually changes.
export type SheetImage = { id: string; driveId: string; name?: string | null };
export type SheetItem = {
  id: string; sheet_id: string; section_id: string | null; name: string | null; sort: number;
  images: SheetImage[];
  added_in: number | null; updated_in: number | null;
  dropped: boolean; dropped_in: number | null;
  client_thumb: "up" | "down" | null; client_thumb_at: string | null; client_thumb_version: number | null;
  client_thumb_note: string | null;   // optional why on a thumbs-down (mig 195)
};
export type SheetSection = { id: string; sheet_id: string; name: string; sort: number };
export type LineSheet = {
  id: string; client_id: string; release_id: string; title: string; season: string | null;
  status: "working" | "final"; current_version: number;
  created_by: string | null; created_at: string; updated_at: string;
};

// NEW / UPDATED badges on the published view, relative to version n.
export function badgeFor(item: Pick<SheetItem, "added_in" | "updated_in">, n: number): "new" | "updated" | null {
  if (item.added_in === n && n > 1) return "new";
  if (item.updated_in === n && item.added_in !== n) return "updated";
  return null;
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
    db.from("line_sheet_items").select("id, section_id, name, item_no, sort, images, added_in, updated_in, dropped, client_thumb, client_thumb_note").eq("sheet_id", sheet.id).order("sort"),
    db.from("line_sheet_versions").select("n, note, published_at").eq("sheet_id", sheet.id).eq("n", n).maybeSingle(),
    publishedImageIds(db, sheet.id),
  ]);
  const items = ((rows || []) as any[])
    .filter(it => !it.dropped && it.added_in != null)
    .map(it => ({ ...it, images: (it.images || []).filter((img: SheetImage) => published.has(img.driveId)) }))
    .filter(it => it.images.length > 0)
    .map(it => ({
      id: it.id, section_id: it.section_id, name: it.name, item_no: it.item_no, sort: it.sort, images: it.images,
      badge: badgeFor(it, n), thumb: it.client_thumb ?? null, note: it.client_thumb_note ?? null,
    }));
  return {
    version: { n, note: (v as any)?.note || null, published_at: (v as any)?.published_at || null },
    sections: ((secs || []) as any[]).map(s => ({ id: s.id, name: s.name, sort: s.sort })),
    items,
  };
}
