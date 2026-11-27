// STUDIO CLEAN-UP → BOARD (Jon, Nov 27 2026). Studio stays HPD's inbox (what
// clients fire at us, briefs, designer files); the board is what the client
// sees. This tool lays out every file on every request of one client, and
// each file gets one of three fates in one pass:
//   keep  = stays in Studio (the default)
//   board = becomes a mockup on the board and leaves Studio (its Drive file
//           stays; the board points at it)
//   trash = leaves Studio and goes nowhere (Drive file trashed if nothing
//           else uses it: lib/brief-files-server)
// A request's board files become ONE draft card (split it on the board if
// they're separate products): its title, the client's comments as the note,
// As is when the request was approved. Nothing reaches the client until HPD
// publishes. Delete this file once every client is cleaned up.
import { newImageId, type SheetImage } from "@/lib/line-sheets";

type Db = any;

export type StudioFile = {
  id: string; name: string | null; kind: string; version: number; createdAt: string;
  driveId: string | null;   // what a thumbnail and the board can show; null = no picture (layered PSD without a preview)
  onBoard: boolean;         // this picture is already on the board
};
export type StudioRequest = { id: string; title: string; state: string; updatedAt: string; files: StudioFile[]; clientNote: string | null };

// A PSD's flat preview first: the layered file is huge and often has no Drive
// thumbnail. AI/PDF have none, but Drive thumbnails them.
const viewable = (f: any): string | null => {
  if (f.preview_drive_file_id) return f.preview_drive_file_id;
  const m = String(f.mime_type || "");
  if (m.includes("photoshop")) return null;
  return m.startsWith("image/") || m.includes("postscript") || m.includes("pdf") ? f.drive_file_id : null;
};

export async function studioRequests(db: Db, clientId: string, boardDriveIds: Set<string>): Promise<StudioRequest[]> {
  const { data: briefs } = await db.from("art_briefs").select("id, title, state, updated_at").eq("client_id", clientId).is("deleted_at", null).order("updated_at", { ascending: false }).range(0, 999);
  const ids = ((briefs || []) as any[]).map(b => b.id);
  if (!ids.length) return [];
  const [{ data: files }, { data: comments }] = await Promise.all([
    db.from("art_brief_files").select("id, brief_id, kind, version, mime_type, drive_file_id, preview_drive_file_id, file_name, created_at").in("brief_id", ids).order("created_at", { ascending: false }).range(0, 999),
    db.from("art_brief_file_comments").select("brief_id, body, created_at").in("brief_id", ids).eq("sender_role", "client").order("created_at", { ascending: false }).range(0, 999),
  ]);
  return ((briefs || []) as any[]).map(b => {
    const said = ((comments || []) as any[]).filter(c => c.brief_id === b.id).map(c => String(c.body).replace(/\s*\n\s*/g, " ").trim()).filter(Boolean);
    return {
      id: b.id, title: b.title || "Untitled", state: b.state, updatedAt: b.updated_at,
      // the client's words, newest first, as much as a note holds
      clientNote: said.join(" · ").slice(0, 500) || null,
      files: ((files || []) as any[]).filter(f => f.brief_id === b.id).map(f => {
        const driveId = viewable(f);
        return { id: f.id, name: f.file_name || null, kind: f.kind, version: Number(f.version) || 0, createdAt: f.created_at, driveId, onBoard: !!driveId && boardDriveIds.has(driveId) };
      }),
    };
  }).filter(r => r.files.length > 0);
}

// The card a request's board picks become (oldest first, so a front uploaded
// before its back stays in front).
export function cardFrom(r: StudioRequest, fileIds: Set<string>): { name: string; images: SheetImage[] } | null {
  const picked = r.files.filter(f => fileIds.has(f.id) && f.driveId && !f.onBoard).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (!picked.length) return null;
  return { name: r.title, images: picked.map(f => ({ id: newImageId(), driveId: f.driveId!, name: f.name })) };
}
