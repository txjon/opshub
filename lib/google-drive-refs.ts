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
// Every table that can point at a physical Drive file. item_files is only one
// of them: a brief's file becomes a product mockup (products-server), a
// designer's final becomes a print file (promote-final), the legacy archive
// (1,565 rows) and client documents live in Drive too. Counting item_files
// alone meant replacing one product's mockup could trash a brief's file
// (Phase 0, Sep 2026).
type RefTable = { table: string; column: string };
const REF_TABLES: RefTable[] = [
  { table: "item_files", column: "drive_file_id" },
  { table: "art_brief_files", column: "drive_file_id" },
  { table: "art_brief_files", column: "preview_drive_file_id" },
  { table: "lineup_options", column: "drive_file_id" },
  { table: "client_files", column: "drive_file_id" },
  { table: "legacy_art_files", column: "drive_file_id" },
];

/** Where else (outside item_files) does this Drive file id appear? */
export async function otherRefsToDriveFile(
  db: any,
  driveFileId: string,
  excludeItemFileId?: string,
  opts?: { excludeItemIds?: string[] }
): Promise<{ table: string; column: string; id: string }[]> {
  const hits: { table: string; column: string; id: string }[] = [];
  for (const { table, column } of REF_TABLES) {
    let q = db.from(table).select("id").eq(column, driveFileId).limit(5);
    // item_files: only ACTIVE rows count, and never the row being removed.
    if (table === "item_files") {
      q = q.is("superseded_at", null);
      if (excludeItemFileId) q = q.neq("id", excludeItemFileId);
      // Rows on items that are being removed right now don't count as users
      // of the file — they are about to go.
      const ex = opts?.excludeItemIds || [];
      if (ex.length) q = q.not("item_id", "in", `(${ex.join(",")})`);
    }
    const { data, error } = await q;
    if (error) {
      // A missing table must never read as "no references" — that would green-light
      // a delete. Report it as a reference so the file is kept.
      if (!/does not exist|schema cache/i.test(error.message)) hits.push({ table, column, id: "unknown" });
      continue;
    }
    for (const r of (data || [])) hits.push({ table, column, id: (r as any).id });
  }
  // The catalog keeps its mockup inside a jsonb blob, so it needs its own look.
  try {
    const { data } = await db.from("products").select("id").eq("spec->>mockup_drive_file_id", driveFileId).limit(5);
    for (const r of (data || [])) hits.push({ table: "products", column: "spec.mockup_drive_file_id", id: (r as any).id });
  } catch { /* table may not exist in this tenant */ }
  return hits;
}

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
    const hits = await otherRefsToDriveFile(db, driveFileId, excludeItemFileId);
    if (hits.length > 0) return { deleted: false, refs: hits.length }; // still in use — keep the file
    await trashFile(driveFileId); // last reference — trash (recoverable), never permanent
    return { deleted: true, refs: 0 };
  } catch {
    return { deleted: false, refs: 0 };
  }
}
