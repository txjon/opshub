// Does the file we point at still exist?
//
// Nothing ever asked. In September 2026 a client's catalog showed blank tiles
// and the audit found 45 Drive files referenced by live OpsHub records that had
// been deleted months earlier — 8 of the 9 traceable deletions were OpsHub's
// own delete paths, since closed in Phase 0. The loss was silent because no
// check existed.
//
// This is that check. The health cron verifies a SLICE of the library each run
// (oldest-checked first) so the whole set is covered daily without a long job,
// and anything missing is reported in the Ops Health email until it's resolved.

import { createClient } from "@supabase/supabase-js";
import { getAccessToken } from "./drive-auth";

export type MissingFile = {
  driveFileId: string;
  fileName: string | null;
  stage: string | null;
  itemName: string | null;
  jobNumber: string | null;
  clientName: string | null;
  firstMissingAt: string | null;
};

/** Every distinct Drive file id a live OpsHub record points at. */
async function referencedFileIds(db: any): Promise<Map<string, { file_name: string; stage: string; item_id: string | null }>> {
  const out = new Map<string, { file_name: string; stage: string; item_id: string | null }>();
  let from = 0;
  for (;;) {
    const { data, error } = await db.from("item_files")
      .select("drive_file_id, file_name, stage, item_id")
      // Approved proofs stay monitored after they are superseded — they are
      // the record of a client sign-off (Sep 2026 review).
      .or("superseded_at.is.null,and(stage.eq.proof,approval.eq.approved)")
      .not("drive_file_id", "is", null)
      .range(from, from + 999);
    if (error) break;
    for (const r of (data || [])) if (!out.has(r.drive_file_id)) out.set(r.drive_file_id, { file_name: r.file_name, stage: r.stage, item_id: r.item_id });
    if (!data || data.length < 1000) break;
    from += 1000;
  }
  // Brief art and client documents matter too — a designer's final can be an
  // item's print file, and a tax document going missing is worth knowing.
  for (const [table, stage] of [["art_brief_files", "brief"], ["client_files", "client-document"]] as const) {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("drive_file_id, file_name")
        .not("drive_file_id", "is", null).range(from, from + 999);
      if (error) break;
      for (const r of (data || [])) if (!out.has(r.drive_file_id)) out.set(r.drive_file_id, { file_name: r.file_name, stage, item_id: null });
      if (!data || data.length < 1000) break;
    }
  }
  return out;
}

async function existsInDrive(token: string, id: string): Promise<boolean | null> {
  try {
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=id,trashed&supportsAllDrives=true`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) return false;
    if (!res.ok) return null;                 // transient: don't record a verdict
    const meta = await res.json().catch(() => null);
    return meta ? !meta.trashed : null;
  } catch { return null; }
}

/**
 * Verify a slice of the library, oldest-checked first, within a time budget.
 * Returns how many were checked and how many are newly missing.
 */
export async function scanFileHealth(opts?: { budgetMs?: number; concurrency?: number }): Promise<{ checked: number; missing: number; newlyMissing: number }> {
  const budgetMs = opts?.budgetMs ?? 25_000;
  const concurrency = opts?.concurrency ?? 10;
  const started = Date.now();
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const refs = await referencedFileIds(db);
  const ids = Array.from(refs.keys());
  if (!ids.length) return { checked: 0, missing: 0, newlyMissing: 0 };

  // Drop rows for files nothing references any more.
  // PAGINATED: an un-ranged select is silently capped at 1000 rows, which made
  // already-known losses read as new ones every run.
  const known: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from("file_health")
      .select("drive_file_id, last_checked_at, missing, first_missing_at").range(from, from + 999);
    if (error) break;
    known.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  const knownMap = new Map(known.map((r: any) => [r.drive_file_id, r]));
  const stale = known.filter((r: any) => !refs.has(r.drive_file_id)).map((r: any) => r.drive_file_id);
  for (let i = 0; i < stale.length; i += 200) await db.from("file_health").delete().in("drive_file_id", stale.slice(i, i + 200));

  // Never-checked first, then oldest-checked. Missing files are re-checked
  // every run so a restored file clears itself.
  const queue = ids.sort((a, b) => {
    const ra: any = knownMap.get(a), rb: any = knownMap.get(b);
    if (ra?.missing && !rb?.missing) return -1;
    if (rb?.missing && !ra?.missing) return 1;
    const ta = ra?.last_checked_at || "", tb = rb?.last_checked_at || "";
    return ta.localeCompare(tb);
  });

  const token = await getAccessToken();
  let checked = 0, newlyMissing = 0, cursor = 0;
  const now = new Date().toISOString();

  const worker = async () => {
    while (cursor < queue.length && Date.now() - started < budgetMs) {
      const id = queue[cursor++];
      const ok = await existsInDrive(token, id);
      if (ok === null) continue;              // transient error: leave it for next run
      const meta = refs.get(id)!;
      const was: any = knownMap.get(id);
      if (!ok && !was?.missing) newlyMissing++;
      await db.from("file_health").upsert({
        drive_file_id: id,
        last_checked_at: now,
        missing: !ok,
        first_missing_at: !ok ? (was?.first_missing_at || now) : null,
        file_name: meta.file_name, stage: meta.stage, item_id: meta.item_id,
      }, { onConflict: "drive_file_id" });
      checked++;
    }
  };
  await Promise.all(Array.from({ length: concurrency }, worker));

  const { count } = await db.from("file_health").select("drive_file_id", { count: "exact", head: true }).eq("missing", true);
  return { checked, missing: count || 0, newlyMissing };
}

/** Everything currently known to be missing, newest loss first, for the email. */
export async function missingFiles(db: any, limit = 20): Promise<MissingFile[]> {
  const { data } = await db.from("file_health")
    .select("drive_file_id, file_name, stage, item_id, first_missing_at")
    .eq("missing", true).order("first_missing_at", { ascending: false }).limit(limit);
  const rows = data || [];
  const itemIds = rows.map((r: any) => r.item_id).filter(Boolean);
  const byItem = new Map<string, any>();
  if (itemIds.length) {
    const { data: items } = await db.from("items").select("id, name, jobs(job_number, clients(name))").in("id", itemIds);
    for (const it of (items || [])) byItem.set((it as any).id, it);
  }
  return rows.map((r: any) => {
    const it = r.item_id ? byItem.get(r.item_id) : null;
    return {
      driveFileId: r.drive_file_id,
      fileName: r.file_name,
      stage: r.stage,
      itemName: it?.name || null,
      jobNumber: it?.jobs?.job_number || null,
      clientName: it?.jobs?.clients?.name || null,
      firstMissingAt: r.first_missing_at,
    };
  });
}
