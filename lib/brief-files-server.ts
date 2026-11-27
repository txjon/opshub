// Removing one file from a Studio request. ONE path for the request page's
// delete and the board's Studio clean-up (lib/studio-import).
import { detachFileFromWorkOrders } from "@/lib/design-work-orders-server";
import { deleteDriveFileIfUnreferenced } from "@/lib/google-drive-refs";

// trash: false = the file moved somewhere (the board): only the Studio row
// goes and the Drive file stays put. true = it goes nowhere: the Drive file is
// trashed (recoverable) ONLY if nothing else references it (the shared-drive
// ref-count rule: the fork copies brief art onto items BY REFERENCE, so a
// blind delete would wipe another surface's art).
export async function removeBriefFile(db: any, fileId: string, opts: { trash: boolean }): Promise<string | null> {
  const { data: file } = await db.from("art_brief_files").select("id, brief_id, drive_file_id").eq("id", fileId).maybeSingle();
  if (!file) return "Not found";
  // Designer-door deliveries that pointed at this file lose it (and their
  // order's state is re-derived) BEFORE the row goes, never a stale "Delivered".
  await detachFileFromWorkOrders(fileId);
  // If this version is the banked pin, unpin first.
  await db.from("art_briefs").update({ approved_file_id: null }).eq("id", file.brief_id).eq("approved_file_id", fileId);
  const { error } = await db.from("art_brief_files").delete().eq("id", fileId);
  if (error) return error.message;
  const driveId = file.drive_file_id;
  if (opts.trash && driveId) {
    // Two ref surfaces: sibling brief files first, then the helper checks
    // item_files, line sheets and the rest, and trashes only when clean.
    const { count } = await db.from("art_brief_files").select("id", { count: "exact", head: true }).eq("drive_file_id", driveId);
    const { count: lineupRefs } = await db.from("lineup_options").select("id", { count: "exact", head: true }).eq("drive_file_id", driveId);
    if ((count || 0) + (lineupRefs || 0) === 0) { try { await deleteDriveFileIfUnreferenced(driveId); } catch {} }
  }
  return null;
}
