#!/usr/bin/env node
/**
 * One-time migration: move every art_brief_files row in Drive from the
 * old flat folder into the new nested hierarchy:
 *   OpsHub Files / Art Studio / {Client Name} / {Brief Title} /
 *
 * Usage:
 *   node scripts/migrate-art-files-to-nested.js              # dry-run
 *   node scripts/migrate-art-files-to-nested.js --commit     # moves files
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

// Raw fetch against Drive REST API — matches lib/drive-token.ts pattern.
// The googleapis client library was returning phantom 404s in batch loops
// for reasons I couldn't pin down. Raw fetch is rock-solid.

async function getToken() {
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
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  return token.token;
}

async function driveGet(token, fileId) {
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,parents`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`GET ${fileId} → ${r.status} ${await r.text()}`);
  return r.json();
}

async function driveListFolders(token, name, parentId) {
  const q = encodeURIComponent(
    `name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`
  );
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!r.ok) throw new Error(`LIST → ${r.status} ${await r.text()}`);
  return (await r.json()).files || [];
}

async function driveCreateFolder(token, name, parentId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name, mimeType: "application/vnd.google-apps.folder", parents: [parentId],
    }),
  });
  if (!r.ok) throw new Error(`CREATE → ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

async function driveMove(token, fileId, addParent, removeParents) {
  const qs = `addParents=${addParent}&removeParents=${removeParents}&fields=id,parents`;
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${qs}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!r.ok) throw new Error(`MOVE → ${r.status} ${await r.text()}`);
  return r.json();
}

// Folder cache
const folderCache = new Map();
async function findOrCreateFolder(token, name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const existing = await driveListFolders(token, name, parentId);
  if (existing.length > 0) {
    folderCache.set(key, existing[0].id);
    return existing[0].id;
  }
  if (!COMMIT) {
    log(`  [dry] would create folder "${name}" under ${parentId}`);
    folderCache.set(key, "DRY_RUN_PLACEHOLDER");
    return "DRY_RUN_PLACEHOLDER";
  }
  const newId = await driveCreateFolder(token, name, parentId);
  folderCache.set(key, newId);
  return newId;
}

async function getOrCreateNested(token, segments) {
  let parent = ROOT_ID;
  for (const raw of segments) {
    const name = (raw || "Untitled").trim().replace(/[\/\\]+/g, "-").slice(0, 120) || "Untitled";
    parent = await findOrCreateFolder(token, name, parent);
    if (parent === "DRY_RUN_PLACEHOLDER") return parent;
  }
  return parent;
}

async function main() {
  if (!ROOT_ID) { err("Missing GOOGLE_DRIVE_ROOT_FOLDER_ID"); process.exit(1); }
  log(`Mode: ${COMMIT ? "COMMIT" : "DRY-RUN"}`);
  log(`Drive root: ${ROOT_ID}\n`);

  const token = await getToken();
  log("✓ Got Drive token\n");

  const { data: files, error } = await sb
    .from("art_brief_files")
    .select("id, drive_file_id, file_name, kind, brief_id, art_briefs(title, clients(name))")
    .not("drive_file_id", "is", null);

  if (error) { err("Supabase error:", error.message); process.exit(1); }
  log(`Found ${files.length} files with Drive IDs\n`);

  let moved = 0, skipped = 0, errored = 0;

  for (const f of files) {
    const briefTitle = f.art_briefs?.title || f.brief_id;
    const clientName = f.art_briefs?.clients?.name || "Unassigned";
    const segments = ["Art Studio", clientName, briefTitle];
    const label = `[${f.kind}] ${f.file_name}  (${clientName} / ${briefTitle})`;
    const fileId = String(f.drive_file_id).trim();

    try {
      const current = await driveGet(token, fileId);
      const currentParents = current.parents || [];

      const targetId = await getOrCreateNested(token, segments);

      if (targetId === "DRY_RUN_PLACEHOLDER") {
        log(`[dry] ${label}  →  would move (current: ${currentParents[0] || "?"})`);
        moved++;
        continue;
      }

      if (currentParents.includes(targetId)) {
        skipped++;
        continue;
      }

      if (!COMMIT) {
        log(`[dry] ${label}  →  would move from ${currentParents[0]} to ${targetId}`);
        moved++;
        continue;
      }

      await driveMove(token, fileId, targetId, currentParents.join(","));
      ok(`${label}  →  moved`);
      moved++;
    } catch (e) {
      err(`${label} — ${e.message}`);
      errored++;
    }
  }

  log(`\n── Summary ──`);
  log(`Moved:   ${moved}`);
  log(`Skipped: ${skipped}`);
  log(`Errors:  ${errored}`);
  if (!COMMIT) log(`\nRun with --commit to actually move.`);
}

main().catch(e => { err(e); process.exit(1); });
