#!/usr/bin/env node
/**
 * One-time migration: move every art_brief_files row in Drive from the
 * old flat folder (/Receiving/Art Brief References-{Client}-{Brief}/ or
 * /Receiving/Art Brief Work-{Brief}/) into the new nested hierarchy:
 *   OpsHub Files / Art Studio / {Client Name} / {Brief Title} /
 *
 * Usage:
 *   node scripts/migrate-art-files-to-nested.js              # dry-run (safe)
 *   node scripts/migrate-art-files-to-nested.js --commit     # actually moves
 *
 * Idempotent-ish: if a file is already under the target folder, it's
 * skipped. If destination folder doesn't exist, it gets created.
 *
 * Does NOT delete old folders — do that manually after verifying.
 */

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
require("dotenv").config({ path: ".env.local" });

const COMMIT = process.argv.includes("--commit");
const ROOT_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const log = (...a) => console.log(...a);
const err = (...a) => console.error("❌", ...a);
const ok = (...a) => console.log("✓", ...a);

async function getDriveClient() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  } else {
    const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "";
    key = JSON.parse(Buffer.from(b64, "base64").toString("utf-8"));
  }
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  const authClient = await auth.getClient();
  return google.drive({ version: "v3", auth: authClient });
}

// Folder cache so we don't thrash Drive with dupe lookups
const folderCache = new Map();

async function findOrCreateFolder(drive, name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);

  const q = `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;
  const search = await drive.files.list({
    q, fields: "files(id)", spaces: "drive",
  });
  if (search.data.files && search.data.files.length > 0) {
    folderCache.set(key, search.data.files[0].id);
    return search.data.files[0].id;
  }
  if (!COMMIT) {
    log(`  [dry] would create folder "${name}" under ${parentId}`);
    folderCache.set(key, "DRY_RUN_PLACEHOLDER");
    return "DRY_RUN_PLACEHOLDER";
  }
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
  });
  folderCache.set(key, created.data.id);
  return created.data.id;
}

async function getOrCreateNestedFolder(drive, segments) {
  let parent = ROOT_ID;
  for (const raw of segments) {
    const name = (raw || "Untitled").trim().replace(/[\/\\]+/g, "-").slice(0, 120) || "Untitled";
    parent = await findOrCreateFolder(drive, name, parent);
  }
  return parent;
}

async function main() {
  if (!ROOT_ID) {
    err("Missing GOOGLE_DRIVE_ROOT_FOLDER_ID env var");
    process.exit(1);
  }
  log(`Mode: ${COMMIT ? "COMMIT (files will move)" : "DRY-RUN (no changes)"}`);
  log(`Drive root: ${ROOT_ID}\n`);

  const drive = await getDriveClient();

  // Pull every art_brief_file with a drive_file_id + its brief + client name
  const { data: files, error } = await sb
    .from("art_brief_files")
    .select("id, drive_file_id, file_name, kind, brief_id, art_briefs(title, clients(name))")
    .not("drive_file_id", "is", null);

  if (error) {
    err("Supabase query failed:", error.message);
    process.exit(1);
  }
  log(`Found ${files.length} files with Drive IDs to check\n`);

  let moved = 0, skipped = 0, errored = 0;

  for (const f of files) {
    const briefTitle = f.art_briefs?.title || f.brief_id;
    const clientName = f.art_briefs?.clients?.name || "Unassigned";
    const segments = ["Art Studio", clientName, briefTitle];
    const label = `[${f.kind}] ${f.file_name}  (${clientName} / ${briefTitle})`;

    try {
      // Look up current parents so we know what to remove
      const current = await drive.files.get({
        fileId: f.drive_file_id,
        fields: "id, parents, name",
      });
      const currentParents = current.data.parents || [];

      // Compute target folder
      const targetId = await getOrCreateNestedFolder(drive, segments);
      if (targetId === "DRY_RUN_PLACEHOLDER") {
        log(`[dry] ${label} → would move`);
        moved++;
        continue;
      }

      if (currentParents.includes(targetId)) {
        skipped++;
        continue;
      }

      if (!COMMIT) {
        log(`[dry] ${label} → would move from ${currentParents.join(",")} to ${targetId}`);
        moved++;
        continue;
      }

      await drive.files.update({
        fileId: f.drive_file_id,
        addParents: targetId,
        removeParents: currentParents.join(","),
        fields: "id, parents",
      });
      ok(`${label} → moved`);
      moved++;
    } catch (e) {
      err(`${label} — ${e.message}`);
      errored++;
    }
  }

  log(`\n── Summary ──`);
  log(`Moved:   ${moved}`);
  log(`Skipped: ${skipped} (already in target)`);
  log(`Errors:  ${errored}`);
  if (!COMMIT) log(`\nRun with --commit to actually move the files.`);
}

main().catch(e => { err(e); process.exit(1); });
