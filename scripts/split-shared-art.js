#!/usr/bin/env node
/**
 * Give every product its own physical art file.
 *
 * Two items pointing at ONE Drive file is how replacing art on a reorder
 * destroyed the original's, and how deleting a duplicate took a file the
 * survivor still needed (Low Life Blue Tee, Sep 2026 — no copy survived
 * anywhere). New copies have had their own files since the duplicate route was
 * fixed; this splits the ones already sharing.
 *
 * The OLDEST row keeps the original. Every other item gets a server-side copy
 * in its own folder, and its record is repointed at it. Google does the
 * copying, so a 500MB PSD costs seconds and no bytes pass through here.
 *
 * Packing slips are deliberately NOT split: one slip belongs to a box, not to
 * a product, and every item in that box should point at the same one.
 *
 *   node scripts/split-shared-art.js           # dry run, changes nothing
 *   node scripts/split-shared-art.js --apply   # do it
 *   node scripts/split-shared-art.js --apply --limit 5
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const { JWT } = require("google-auth-library");

const APPLY = process.argv.includes("--apply");
const LIMIT = (() => { const i = process.argv.indexOf("--limit"); return i > -1 ? parseInt(process.argv[i + 1], 10) : 0; })();
const ART_STAGES = ["mockup", "print_ready", "proof", "vector", "client_art"];

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function driveToken() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64
    ? Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64, "base64").toString()
    : (process.env.GOOGLE_SERVICE_ACCOUNT_KEY || "");
  const c = JSON.parse(raw);
  const cl = new JWT({
    email: c.client_email, key: (c.private_key || "").replace(/\\n/g, "\n"),
    scopes: ["https://www.googleapis.com/auth/drive"],
    subject: process.env.GOOGLE_IMPERSONATE_USER || "jon@housepartydistro.com",
  });
  return (await cl.getAccessToken()).token;
}

const pageAll = async (table, sel) => {
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await db.from(table).select(sel).range(i, i + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data || !data.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
};

(async () => {
  const token = await driveToken();

  const files = (await pageAll("item_files", "id,item_id,drive_file_id,file_name,stage,superseded_at,created_at"))
    .filter(f => !f.superseded_at && f.drive_file_id && ART_STAGES.includes(f.stage));

  const byDrive = new Map();
  for (const f of files) { const a = byDrive.get(f.drive_file_id) || []; a.push(f); byDrive.set(f.drive_file_id, a); }
  let shared = [...byDrive.entries()].filter(([, rows]) => new Set(rows.map(r => r.item_id)).size > 1);
  if (LIMIT) shared = shared.slice(0, LIMIT);

  // item + job context, for folder resolution
  const itemIds = [...new Set(shared.flatMap(([, rows]) => rows.map(r => r.item_id)))];
  const items = [];
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await db.from("items").select("id,name,job_id,drive_folder_id").in("id", itemIds.slice(i, i + 200));
    items.push(...(data || []));
  }
  const byItem = new Map(items.map(i => [i.id, i]));
  const jobIds = [...new Set(items.map(i => i.job_id))];
  const jobs = [];
  for (let i = 0; i < jobIds.length; i += 200) {
    const { data } = await db.from("jobs").select("id,job_number,title,phase,clients:client_id(name)").in("id", jobIds.slice(i, i + 200));
    jobs.push(...(data || []));
  }
  const byJob = new Map(jobs.map(j => [j.id, j]));

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"} — ${shared.length} shared art files\n`);

  let copied = 0, skipped = 0, failed = 0;
  for (const [driveId, rows] of shared) {
    // oldest row keeps the original
    const ordered = [...rows].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    const keeper = ordered[0];
    const movers = ordered.slice(1).filter(r => r.item_id !== keeper.item_id);

    for (const r of movers) {
      const it = byItem.get(r.item_id);
      const job = it && byJob.get(it.job_id);
      const label = `${job?.job_number || "?"} / ${it?.name || "?"} · ${r.stage} · ${String(r.file_name).slice(0, 34)}`;

      // the item must have its OWN folder to copy into
      let folderId = it?.drive_folder_id || null;
      if (!folderId) { console.log(`  SKIP  ${label}  (item has no folder of its own)`); skipped++; continue; }
      if (!APPLY) { console.log(`  copy  ${label}`); copied++; continue; }

      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${driveId}/copy?supportsAllDrives=true&fields=id,name,size,webViewLink`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: r.file_name, parents: [folderId] }),
      });
      if (!res.ok) { console.log(`  FAIL  ${label}  (copy ${res.status})`); failed++; continue; }
      const copy = await res.json();
      const { error } = await db.from("item_files").update({
        drive_file_id: copy.id,
        drive_link: copy.webViewLink || `https://drive.google.com/file/d/${copy.id}/view`,
        file_size: Number(copy.size) || null,
      }).eq("id", r.id);
      if (error) { console.log(`  FAIL  ${label}  (record ${error.message})`); failed++; continue; }
      console.log(`  done  ${label}`);
      copied++;
    }
  }
  console.log(`\n${APPLY ? "copied" : "would copy"}: ${copied} | skipped: ${skipped} | failed: ${failed}`);
  if (!APPLY) console.log("\nnothing was changed. re-run with --apply");
})().catch(e => { console.error(e); process.exit(1); });
