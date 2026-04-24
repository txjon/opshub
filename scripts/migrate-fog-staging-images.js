#!/usr/bin/env node
/**
 * Migrate staging_item_images on the "FOG Working" staging board onto
 * matching items in the "FOG Working" project. Each image goes to
 * Google Drive under the item's folder and gets an item_files row so
 * OpsHub + Client Hub portal render it as a thumbnail.
 *
 * Match = exact (case-insensitive, trimmed) item name between
 * staging_items.item_name and items.name.
 *
 * Usage:
 *   node scripts/migrate-fog-staging-images.js           # dry run
 *   node scripts/migrate-fog-staging-images.js --apply   # actually move
 */

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
const { Readable } = require("stream");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const ROOT_FOLDER_ID = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

function getDrive() {
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
  return google.drive({ version: "v3", auth });
}

async function findOrCreateFolder(drive, name, parentId) {
  const esc = name.replace(/'/g, "\\'");
  const q = `name = '${esc}' and mimeType = 'application/vnd.google-apps.folder' and '${parentId}' in parents and trashed = false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1 });
  if (list.data.files && list.data.files.length > 0) return list.data.files[0].id;
  const created = await drive.files.create({
    requestBody: { name, mimeType: "application/vnd.google-apps.folder", parents: [parentId] },
    fields: "id",
  });
  return created.data.id;
}

async function getItemFolderId(drive, clientName, projectTitle, itemName) {
  const clientFolder = await findOrCreateFolder(drive, clientName, ROOT_FOLDER_ID);
  const projectFolder = await findOrCreateFolder(drive, projectTitle, clientFolder);
  return await findOrCreateFolder(drive, itemName, projectFolder);
}

async function uploadFile(drive, folderId, fileName, mimeType, buffer) {
  const stream = new Readable(); stream.push(buffer); stream.push(null);
  const res = await drive.files.create({
    requestBody: { name: fileName, parents: [folderId] },
    media: { mimeType, body: stream },
    fields: "id,webViewLink",
  });
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: { role: "reader", type: "anyone" },
  });
  return { fileId: res.data.id, webViewLink: res.data.webViewLink || "" };
}

function guessMime(name) {
  const ext = (name || "").toLowerCase().split(".").pop();
  const map = {
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif",
    webp: "image/webp", heic: "image/heic", pdf: "application/pdf",
  };
  return map[ext] || "application/octet-stream";
}

(async () => {
  console.log(APPLY ? "APPLYING changes.\n" : "DRY RUN — use --apply to actually move files.\n");

  const { data: jobs } = await sb.from("jobs")
    .select("id, title, clients(name)")
    .ilike("title", "FOG Working")
    .limit(1);
  if (!jobs?.length) { console.error("No FOG Working job found"); process.exit(1); }
  const job = jobs[0];
  const clientName = job.clients?.name || "Forward Observations Group";
  console.log(`Job: ${job.title} (${job.id})`);
  console.log(`Client: ${clientName}\n`);

  const { data: boards } = await sb.from("staging_boards")
    .select("id, name").ilike("name", "FOG Working").limit(1);
  if (!boards?.length) { console.error("No FOG Working staging board found"); process.exit(1); }
  const board = boards[0];

  const { data: items } = await sb.from("items")
    .select("id, name, drive_link")
    .eq("job_id", job.id);

  const { data: stagingItems } = await sb.from("staging_items")
    .select("id, item_name")
    .eq("board_id", board.id);

  const { data: stagingImages } = await sb.from("staging_item_images")
    .select("id, item_id, storage_path, filename")
    .in("item_id", (stagingItems || []).map(s => s.id));

  // Also pull existing item_files so we can skip already-migrated items.
  const { data: existingFiles } = await sb.from("item_files")
    .select("item_id")
    .in("item_id", (items || []).map(i => i.id))
    .is("superseded_at", null);
  const alreadyHasFiles = new Set((existingFiles || []).map(f => f.item_id));

  const imagesByStagingItem = {};
  for (const img of stagingImages || []) {
    (imagesByStagingItem[img.item_id] ||= []).push(img);
  }

  const normName = s => (s || "").trim().toLowerCase();
  const stagingByName = {};
  for (const s of stagingItems || []) stagingByName[normName(s.item_name)] = s;

  const drive = APPLY ? getDrive() : null;

  const plan = [];
  const skipped = [];

  for (const item of items || []) {
    const match = stagingByName[normName(item.name)];
    if (!match) { skipped.push({ item, reason: "no staging match" }); continue; }
    const imgs = imagesByStagingItem[match.id] || [];
    if (imgs.length === 0) { skipped.push({ item, reason: "staging has no images" }); continue; }
    if (alreadyHasFiles.has(item.id)) { skipped.push({ item, reason: "already has item_files" }); continue; }
    plan.push({ item, match, imgs });
  }

  console.log(`Plan: ${plan.length} items will receive images.\n`);
  plan.forEach(p => {
    console.log(`  → "${p.item.name}"  (${p.imgs.length} image${p.imgs.length === 1 ? "" : "s"})`);
    p.imgs.forEach(i => console.log(`       ${i.filename || i.storage_path}`));
  });

  if (skipped.length) {
    console.log(`\nSkipped: ${skipped.length}`);
    const byReason = {};
    skipped.forEach(s => (byReason[s.reason] ||= []).push(s.item.name));
    for (const [reason, names] of Object.entries(byReason)) {
      console.log(`  · ${reason}: ${names.length}`);
      names.slice(0, 6).forEach(n => console.log(`       ${n}`));
      if (names.length > 6) console.log(`       … and ${names.length - 6} more`);
    }
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to migrate.");
    return;
  }

  console.log("\n--- APPLYING ---\n");
  let movedImages = 0, skippedApply = 0, errors = 0;

  for (const p of plan) {
    const { item, imgs } = p;
    console.log(`\n"${item.name}" → ${imgs.length} image(s)`);
    let folderId;
    try {
      folderId = await getItemFolderId(drive, clientName, job.title, item.name);
    } catch (e) {
      console.log(`  ✕ folder create failed: ${e.message}`);
      errors++;
      continue;
    }

    for (const img of imgs) {
      try {
        // Download from Supabase Storage
        const { data: blob, error: dlErr } = await sb.storage.from("staging-images").download(img.storage_path);
        if (dlErr || !blob) { console.log(`  ✕ download ${img.filename}: ${dlErr?.message}`); errors++; continue; }
        const arrayBuf = await blob.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        const fileName = img.filename || img.storage_path.split("/").pop();
        const mimeType = guessMime(fileName);

        // Upload to Drive
        const { fileId, webViewLink } = await uploadFile(drive, folderId, fileName, mimeType, buf);

        // Write item_files row
        const { error: insErr } = await sb.from("item_files").insert({
          item_id: item.id,
          file_name: fileName,
          stage: "mockup",
          drive_file_id: fileId,
          drive_link: webViewLink,
          approval: "none",
        });
        if (insErr) { console.log(`  ✕ item_files insert: ${insErr.message}`); errors++; continue; }

        movedImages++;
        console.log(`  ✓ ${fileName}`);
      } catch (e) {
        console.log(`  ✕ ${img.filename || "image"}: ${e.message}`);
        errors++;
      }
    }

    // Update item.drive_link to the folder so admin side can jump straight in
    try {
      const folderLink = `https://drive.google.com/drive/folders/${folderId}`;
      await sb.from("items").update({ drive_link: folderLink }).eq("id", item.id);
    } catch (e) {
      console.log(`  ! could not update item.drive_link: ${e.message}`);
    }
  }

  console.log(`\n✓ Done. Moved: ${movedImages} · Skipped during apply: ${skippedApply} · Errors: ${errors}`);
})().catch(e => { console.error(e); process.exit(1); });
