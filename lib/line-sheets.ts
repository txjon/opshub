// THE LINE SHEET — shared, client-safe model (mig 190, design map artifact
// 4931e236). One list of named concepts per sheet (shelves retired Nov 26
// 2026: sort, numbers and names are enough), published versions, and a
// verdict per item (mig 215) that the client OR HPD sets:
//   asis   = good to go: the only verdict Create order takes
//   change = likes it, wants something changed; the note says what
//   pass   = no
//   liked  = an old thumbs-up nobody has sorted: he's asked "As is, or change?"
// New art on an item clears its verdict: he's asked again about the new
// picture. The note stays, read as "you asked" (noteIsStale).
// replaces = the published picture this unpublished one swapped out (Replace);
// the client keeps seeing that until the next publish.
export type SheetImage = { id: string; driveId: string; name?: string | null; size?: number; replaces?: { driveId: string; name?: string | null } };
export type Verdict = "asis" | "change" | "pass" | "liked";
// what the client and HPD can set (liked only comes from the mig 215 backfill)
export const SETTABLE_VERDICTS = ["asis", "change", "pass"] as const;
export type SheetItem = {
  id: string; sheet_id: string; name: string | null; sort: number;
  images: SheetImage[];
  added_in: number | null; updated_in: number | null;
  dropped: boolean; dropped_in: number | null;
  client_verdict: Verdict | null;
  client_verdict_at: string | null;      // last change, a clear included (mig 216 re-sync relies on it)
  client_verdict_version: number | null; // published version it was set on
  client_verdict_by: "client" | "hpd" | null;
  client_note: string | null;           // the client's note, any verdict or none (mig 213)
  client_note_version: number | null;   // published version it was written on
  client_seen_version: number | null;   // last version the client looked at it on (mig 214)
};
// The write that sets (or clears) a verdict. One place, so the client route
// and HPD's builder route can't drift.
export function verdictPatch(v: Verdict | null, by: "client" | "hpd", version: number) {
  return { client_verdict: v, client_verdict_at: new Date().toISOString(), client_verdict_version: v ? version : null, client_verdict_by: v ? by : null };
}
// Item numbers before the FIRST publish follow the list order: nobody outside
// has seen a number yet. The first publish stamps them for good (route.ts
// publish) and from then on they never move; later items are numbered as
// they're published.
const bySort = (a: { id: string; sort: number }, b: { id: string; sort: number }) => ((a.sort || 0) - (b.sort || 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function sortItems<T extends { id: string; sort: number }>(items: T[]): T[] { return [...items].sort(bySort); }
export function layoutNumbering(items: { id: string; sort: number; dropped?: boolean }[]): Record<string, number> {
  const out: Record<string, number> = {};
  sortItems(items.filter(i => !i.dropped)).forEach((it, k) => { out[it.id] = k + 1; });
  return out;
}

export type LineSheet = {
  id: string; client_id: string; release_id: string; title: string;
  status: "working" | "final"; current_version: number;
  created_by: string | null; created_at: string; updated_at: string;
};

// NEW / UPDATED badges on the published view: they last until the client has
// looked (mig 214: gave a verdict, noted or opened it full screen on that
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
// Organizing is LIVE: names, order, grouping, drops and verdicts show the moment
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
  const [{ data: rows }, { data: v }, published] = await Promise.all([
    db.from("line_sheet_items").select("id, name, item_no, sort, images, added_in, updated_in, dropped, client_verdict, client_verdict_by, client_note, client_note_version, client_seen_version").eq("sheet_id", sheet.id),
    db.from("line_sheet_versions").select("n, note, published_at").eq("sheet_id", sheet.id).eq("n", n).maybeSingle(),
    publishedImageIds(db, sheet.id),
  ]);
  const items = sortItems(((rows || []) as any[]))
    .filter(it => !it.dropped && it.added_in != null)
    .map(it => ({ ...it, images: (it.images || []).map((img: SheetImage) => published.has(img.driveId) ? img
      : img.replaces && published.has(img.replaces.driveId) ? { id: img.id, driveId: img.replaces.driveId, name: img.replaces.name } : null).filter(Boolean) }))
    .filter(it => it.images.length > 0)
    .map(it => ({
      id: it.id, name: it.name, item_no: it.item_no, sort: it.sort, images: it.images,
      badge: badgeFor(it), verdict: (it.client_verdict ?? null) as Verdict | null, verdictBy: it.client_verdict_by ?? null,
      note: it.client_note ?? null, noteStale: noteIsStale(it),
    }));
  return {
    version: { n, note: (v as any)?.note || null, published_at: (v as any)?.published_at || null },
    items,
  };
}
