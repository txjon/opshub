// STUDIO → BOARD, the one-time move (Jon, Nov 26 2026). Studio retires; the
// client's board is where designs live now. Each old request with art becomes
// ONE card: its latest art, its title, the client's last comment as the note.
// Approved requests land as As is (the client approved that art); the rest
// land in Concepts. Cards arrive as drafts: nothing reaches the client until
// HPD publishes. Forward: Jon picks. Sike: everything touched in the last 60
// days comes preselected. Delete this file with Studio.
import { newImageId, type SheetImage } from "@/lib/line-sheets";

type Db = any;
const RECENT_DAYS = 60;
const MAX_IMAGES = 4;

export type StudioRequest = {
  id: string; title: string; state: string; updatedAt: string;
  recent: boolean;            // touched in the last 60 days → preselected
  images: SheetImage[];       // latest art, front first
  clientNote: string | null;  // the client's last comment
  onBoard: boolean;           // its art is already on this board
};

const viewable = (f: any): string | null => {
  // a PSD's flat preview first: the layered file is huge and often has no
  // Drive thumbnail. AI/PDF have none, but Drive thumbnails them.
  if (f.preview_drive_file_id) return f.preview_drive_file_id;
  const m = String(f.mime_type || "");
  if (m.includes("photoshop")) return null;
  return m.startsWith("image/") || m.includes("postscript") || m.includes("pdf") ? f.drive_file_id : null;
};
const clean = (s: string) => s.replace(/\s*\n\s*/g, " ").trim().slice(0, 500) || null;

export async function studioRequests(db: Db, clientId: string, boardDriveIds: Set<string>): Promise<StudioRequest[]> {
  const { data: briefs } = await db.from("art_briefs").select("id, title, state, updated_at").eq("client_id", clientId).is("deleted_at", null).order("updated_at", { ascending: false }).range(0, 999);
  const ids = ((briefs || []) as any[]).map(b => b.id);
  if (!ids.length) return [];
  const [{ data: files }, { data: comments }] = await Promise.all([
    db.from("art_brief_files").select("id, brief_id, kind, version, mime_type, drive_file_id, preview_drive_file_id, file_name, created_at").in("brief_id", ids).neq("kind", "reference").range(0, 4999),
    db.from("art_brief_file_comments").select("brief_id, body, created_at").in("brief_id", ids).eq("sender_role", "client").order("created_at", { ascending: false }).range(0, 4999),
  ]);
  const cut = Date.now() - RECENT_DAYS * 864e5;
  const out: StudioRequest[] = [];
  for (const b of (briefs || []) as any[]) {
    const art = ((files || []) as any[]).filter(f => f.brief_id === b.id && viewable(f));
    if (!art.length) continue;
    const top = Math.max(...art.map(f => Number(f.version) || 0));
    const images = art.filter(f => (Number(f.version) || 0) === top)
      .sort((x, y) => String(y.created_at).localeCompare(String(x.created_at)))
      .slice(0, MAX_IMAGES).reverse()   // the newest few, in upload order
      .map(f => ({ id: newImageId(), driveId: viewable(f)!, name: f.file_name || null }));
    const all = art.map(f => viewable(f)!);
    const last = ((comments || []) as any[]).find(c => c.brief_id === b.id);
    out.push({
      id: b.id, title: b.title || "Untitled", state: b.state, updatedAt: b.updated_at,
      recent: +new Date(b.updated_at) > cut && b.state !== "killed",
      images, clientNote: last ? clean(String(last.body)) : null,
      onBoard: all.some(d => boardDriveIds.has(d)),
    });
  }
  return out;
}
