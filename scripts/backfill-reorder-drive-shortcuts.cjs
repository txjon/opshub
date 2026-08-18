#!/usr/bin/env node
/**
 * Backfill Drive shortcut folders for reorder-cart jobs minted BEFORE
 * copyItemIntoJob learned to pre-create them (see lib/reorder-cart.ts).
 * For each cart-sourced job: ensure Root / {Client} / {Job Title} / {Item}
 * exists and holds a shortcut per live item_files row, so a later upload's
 * drive_link repoint lands in a COMPLETE folder, not an empty one.
 *
 *   node scripts/backfill-reorder-drive-shortcuts.cjs            # dry-run
 *   node scripts/backfill-reorder-drive-shortcuts.cjs --commit   # apply
 */
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
require("dotenv").config({ path: ".env.local" });

const COMMIT = process.argv.includes("--commit");
const ROOT_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Raw fetch against Drive REST — matches scripts/migrate-art-files-to-nested.js.
async function getToken() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  else key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "", "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  return (await (await auth.getClient()).getAccessToken()).token;
}

async function driveListFolders(token, name, parentId) {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&spaces=drive`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`LIST → ${r.status} ${await r.text()}`);
  return (await r.json()).files || [];
}

async function driveCreateFolder(token, name, parentId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  if (!r.ok) throw new Error(`CREATE → ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

async function driveListChildren(token, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,shortcutDetails)&spaces=drive&pageSize=200`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`CHILDREN → ${r.status} ${await r.text()}`);
  return (await r.json()).files || [];
}

async function driveCreateShortcut(token, targetId, name, parentId) {
  const r = await fetch(`https://www.googleapis.com/drive/v3/files?fields=id`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name, mimeType: "application/vnd.google-apps.shortcut", parents: [parentId], shortcutDetails: { targetId } }),
  });
  if (!r.ok) throw new Error(`SHORTCUT → ${r.status} ${await r.text()}`);
  return (await r.json()).id;
}

const folderCache = new Map();
async function findOrCreateFolder(token, name, parentId) {
  const key = `${parentId}::${name}`;
  if (folderCache.has(key)) return folderCache.get(key);
  const existing = await driveListFolders(token, name, parentId);
  let id;
  if (existing.length) id = existing[0].id;
  else if (!COMMIT) { console.log(`  [dry] would create folder "${name}"`); id = null; }
  else id = await driveCreateFolder(token, name, parentId);
  folderCache.set(key, id);
  return id;
}

(async () => {
  if (!ROOT_ID) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID missing");
  const token = await getToken();

  const { data: jobs, error } = await sb.from("jobs")
    .select("id, job_number, title, clients(name)")
    .in("type_meta->>source", ["client_portal_cart", "internal_cart"]);
  if (error) throw error;

  for (const job of jobs || []) {
    const clientName = job.clients?.name;
    if (!clientName || !job.title) continue;
    const { data: items } = await sb.from("items").select("id, name").eq("job_id", job.id);
    if (!(items || []).length) continue;
    console.log(`\n${job.job_number || job.id} — ${clientName} — "${job.title}"`);

    const clientFolder = await findOrCreateFolder(token, clientName, ROOT_ID);
    const projectFolder = clientFolder ? await findOrCreateFolder(token, job.title, clientFolder) : null;

    for (const it of items || []) {
      const { data: files } = await sb.from("item_files")
        .select("file_name, drive_file_id").eq("item_id", it.id).is("superseded_at", null);
      if (!(files || []).length) continue;
      const itemFolder = projectFolder ? await findOrCreateFolder(token, it.name || "Item", projectFolder) : null;
      const children = itemFolder ? await driveListChildren(token, itemFolder) : [];
      const present = new Set(children.flatMap(c => [c.id, c.shortcutDetails?.targetId].filter(Boolean)));
      for (const f of files) {
        if (!f.drive_file_id || present.has(f.drive_file_id)) continue;
        if (!COMMIT || !itemFolder) { console.log(`  · ${it.name}: [dry] would shortcut "${f.file_name}"`); continue; }
        try {
          await driveCreateShortcut(token, f.drive_file_id, f.file_name || "file", itemFolder);
          console.log(`  · ${it.name}: shortcut "${f.file_name}" ✓`);
        } catch (e) { console.error(`  · ${it.name}: shortcut "${f.file_name}" FAILED — ${e.message}`); }
      }
    }
  }
  console.log(COMMIT ? "\nDone." : "\nDry run — nothing written.");
})();
