#!/usr/bin/env node
/**
 * One-off: find items that were just created with no item_files but
 * whose name matches another item that HAS item_files on the same
 * client. Prompt-free: operates only on items created in the last 24h
 * that have zero files. Links them up by copying item_files rows
 * (same drive_file_ids, new item_id).
 *
 * Safe to run repeatedly — skips items that already have any files.
 *
 * Usage:
 *   node scripts/backfill-copied-item-files.js          # dry run
 *   node scripts/backfill-copied-item-files.js --apply  # apply
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = s => (s || "").trim().toLowerCase();

(async () => {
  console.log(APPLY ? "APPLYING.\n" : "DRY RUN — use --apply to backfill.\n");

  // Items created in the last 24h
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentItems } = await sb.from("items")
    .select("id, name, job_id, jobs(client_id, title)")
    .gte("created_at", since);
  console.log(`Items created in last 24h: ${recentItems?.length || 0}`);

  const candidates = [];
  for (const it of recentItems || []) {
    const { data: existing } = await sb.from("item_files")
      .select("id").eq("item_id", it.id).is("superseded_at", null).limit(1);
    if ((existing || []).length > 0) continue; // already has files

    // Find a sibling item for the same client with the same name that has files
    const clientId = it.jobs?.client_id;
    if (!clientId) continue;
    const { data: siblings } = await sb.from("items")
      .select("id, name, jobs!inner(client_id)")
      .ilike("name", it.name)
      .neq("id", it.id);
    const sameClient = (siblings || []).filter(s => s.jobs?.client_id === clientId && norm(s.name) === norm(it.name));
    if (sameClient.length === 0) continue;

    // Find a sibling that has files
    let donor = null;
    for (const s of sameClient) {
      const { data: f } = await sb.from("item_files")
        .select("id, file_name, stage, drive_file_id, drive_link, mime_type, file_size, approval")
        .eq("item_id", s.id).is("superseded_at", null);
      if ((f || []).length > 0) { donor = { item: s, files: f }; break; }
    }
    if (!donor) continue;

    candidates.push({ target: it, donor });
  }

  console.log(`\nCandidates to backfill: ${candidates.length}`);
  for (const c of candidates) {
    console.log(`  "${c.target.name}"  (job: ${c.target.jobs?.title})`);
    console.log(`    ← ${c.donor.files.length} file${c.donor.files.length === 1 ? "" : "s"} from sibling ${c.donor.item.id}`);
  }

  if (!APPLY || candidates.length === 0) {
    if (!APPLY) console.log("\nDry run complete. Re-run with --apply to backfill.");
    return;
  }

  let copiedItems = 0, copiedFiles = 0, errors = 0;
  for (const c of candidates) {
    const rows = c.donor.files.map(f => ({
      item_id: c.target.id,
      file_name: f.file_name,
      stage: f.stage,
      drive_file_id: f.drive_file_id,
      drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
      mime_type: f.mime_type || null,
      file_size: f.file_size || null,
      approval: "none",
    }));
    const { error } = await sb.from("item_files").insert(rows);
    if (error) { console.log(`  ✕ ${c.target.name}: ${error.message}`); errors++; continue; }
    copiedItems++;
    copiedFiles += rows.length;
    console.log(`  ✓ ${c.target.name}  (${rows.length} files)`);
  }
  console.log(`\nDone. Items backfilled: ${copiedItems} · Files created: ${copiedFiles} · Errors: ${errors}`);
})().catch(e => { console.error(e); process.exit(1); });
