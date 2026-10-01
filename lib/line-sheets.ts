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
};
export type SheetSection = { id: string; sheet_id: string; name: string; sort: number };
export type LineSheet = {
  id: string; client_id: string; release_id: string | null; title: string; season: string | null;
  status: "working" | "final"; current_version: number;
  created_by: string | null; created_at: string; updated_at: string;
};

// The carry rule's fingerprint: an item "visually changed" when its image set
// (ids + order) changed. Name/section moves do NOT reset the client's thumb.
export const visualKey = (images: SheetImage[] | null | undefined) =>
  (images || []).map(i => i.driveId).join("|");

// NEW / UPDATED badges on the published view, relative to version n.
export function badgeFor(item: Pick<SheetItem, "added_in" | "updated_in">, n: number): "new" | "updated" | null {
  if (item.added_in === n && n > 1) return "new";
  if (item.updated_in === n && item.added_in !== n) return "updated";
  return null;
}

export const newImageId = () => Math.random().toString(36).slice(2, 9);
