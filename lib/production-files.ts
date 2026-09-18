// Production files = what a PRINTER is allowed to see for an item. ONE source
// of truth for every vendor-facing surface (vendor portal order page, PO PDF)
// and for the PO release snapshot.
//
// Why this exists (HPD-2608-042, Sep 18 2026): the PO's "Production Files"
// button and the vendor portal pointed at the item's RAW Drive folder. The
// folder held three same-named PSDs (two old versions the app no longer
// listed: a re-upload on the source job that never retired the prior file,
// plus duplicate-time shortcuts OpsHub never tracked). ICON picked an old one
// and printed 52 wrong shirts. The app's view and the printer's view were two
// different things. Now they are the same thing: the vendor sees the active
// item_files rows, served through the app, never a folder.
//
// Rules this module enforces:
//   - Vendor surfaces list ONLY active (non-superseded) rows in PRODUCTION_STAGES.
//   - Same file name on the same item + stage = a NEW VERSION: the old row is
//     superseded and its Drive file trashed if nothing else references it
//     (supersedeSameNameFiles). Different names stay side by side — front +
//     tag, front + back seps are normal.
//   - Sending a PO freezes a RELEASE (the exact file rows sent) on
//     type_meta.po_releases[vendor]; releaseDrift() tells every surface whether
//     the live files still match what the printer was given.

import { deleteDriveFileIfUnreferenced } from "./google-drive-refs";
import { PRODUCTION_STAGES, type ProductionFile } from "./po-release";
export * from "./po-release";

const FILE_COLS = "id, item_id, file_name, stage, drive_file_id, mime_type, file_size, created_at";

function toProductionFile(f: any): ProductionFile {
  const name = f.file_name || "file";
  const enc = encodeURIComponent(name);
  return {
    id: f.id,
    itemId: f.item_id,
    name,
    stage: f.stage,
    driveFileId: f.drive_file_id,
    mimeType: f.mime_type || null,
    size: f.file_size == null ? null : Number(f.file_size),
    createdAt: f.created_at,
    viewUrl: `/api/files/view/${enc}?id=${f.drive_file_id}`,
    downloadUrl: `/api/files/view/${enc}?id=${f.drive_file_id}&download=1`,
    thumbUrl: `/api/files/thumbnail?id=${f.drive_file_id}&thumb=1&size=400`,
  };
}

const STAGE_RANK: Record<string, number> = { print_ready: 0, proof: 1, mockup: 2 };

// Active production files for a set of items, print files first, newest
// first within a stage. Chunked + explicitly ranged: Supabase caps un-ranged
// selects at 1000 rows and truncates silently.
export async function loadProductionFiles(sb: any, itemIds: string[]): Promise<Record<string, ProductionFile[]>> {
  const out: Record<string, ProductionFile[]> = {};
  const ids = Array.from(new Set(itemIds.filter(Boolean)));
  for (let i = 0; i < ids.length; i += 150) {
    const slice = ids.slice(i, i + 150);
    let from = 0;
    for (;;) {
      const { data, error } = await sb.from("item_files").select(FILE_COLS)
        .in("item_id", slice).in("stage", PRODUCTION_STAGES as unknown as string[])
        .is("superseded_at", null).not("drive_file_id", "is", null)
        .order("created_at", { ascending: false })
        .range(from, from + 999);
      if (error) throw new Error(error.message);
      for (const f of (data || [])) (out[f.item_id] ||= []).push(toProductionFile(f));
      if (!data || data.length < 1000) break;
      from += 1000;
    }
  }
  for (const k of Object.keys(out)) {
    out[k].sort((a, b) => (STAGE_RANK[a.stage] - STAGE_RANK[b.stage]) || b.createdAt.localeCompare(a.createdAt));
  }
  return out;
}

// A new upload with the same name as an ACTIVE file on the same item + stage
// is a new version of it. Retire the old row (kept for history) and trash its
// Drive file only if no other item still references it (duplicated items share
// drive_file_ids — see lib/google-drive-refs). Returns the retired row ids.
// Proofs and mockups have their own replace-on-upload paths; this is for the
// stages that used to just pile up (print_ready, client_art, vector).
// keepDrive: retire the row but leave the Drive file alone — for files whose
// bytes belong to another record (a designer brief's final).
export async function supersedeSameNameFiles(sb: any, itemId: string, stage: string, fileName: string, opts?: { excludeId?: string; keepDrive?: boolean }): Promise<string[]> {
  const target = (fileName || "").trim().toLowerCase();
  if (!target) return [];
  const { data: existing } = await sb.from("item_files").select("id, file_name, drive_file_id")
    .eq("item_id", itemId).eq("stage", stage).is("superseded_at", null);
  const now = new Date().toISOString();
  const retired: string[] = [];
  for (const old of (existing || []) as any[]) {
    if (old.id === opts?.excludeId) continue;
    if ((old.file_name || "").trim().toLowerCase() !== target) continue;
    // Supersede FIRST so the ref-count below doesn't count this row.
    await sb.from("item_files").update({ superseded_at: now }).eq("id", old.id);
    if (old.drive_file_id && !opts?.keepDrive) await deleteDriveFileIfUnreferenced(old.drive_file_id, old.id);
    retired.push(old.id);
  }
  return retired;
}

