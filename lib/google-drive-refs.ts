import { createClient } from "@supabase/supabase-js";
import { trashFile } from "./google-drive";

/**
 * Reference-counted Drive delete.
 *
 * Item duplication and cross-job re-order copies intentionally SHARE
 * drive_file_ids — a re-order's item_files row points at the SAME physical
 * Drive file as the original ("files are shared assets"). The old delete paths
 * assumed 1:1 and permanently deleted the Drive file whenever one item's row
 * was superseded/removed — which silently destroyed the ORIGINAL item's art
 * (mockups / print files) the moment a duplicate's file was replaced.
 *
 * This deletes the physical Drive file ONLY when no other ACTIVE (non-superseded)
 * item_files row still references it. Uses the service role so it sees
 * references in OTHER jobs (cross-job re-orders) that RLS would hide from the
 * caller's session.
 */
export async function deleteDriveFileIfUnreferenced(
  driveFileId: string | null | undefined,
  excludeItemFileId?: string
): Promise<{ deleted: boolean; refs: number }> {
  if (!driveFileId) return { deleted: false, refs: 0 };
  try {
    const db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    );
    let q = db
      .from("item_files")
      .select("id")
      .eq("drive_file_id", driveFileId)
      .is("superseded_at", null);
    if (excludeItemFileId) q = q.neq("id", excludeItemFileId);
    const { data: others } = await q;
    const refs = (others || []).length;
    if (refs > 0) return { deleted: false, refs }; // still in use elsewhere — keep the file
    await trashFile(driveFileId); // last reference — trash (recoverable), don't permanently delete
    return { deleted: true, refs: 0 };
  } catch {
    return { deleted: false, refs: 0 };
  }
}
