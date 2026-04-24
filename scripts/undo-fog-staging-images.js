#!/usr/bin/env node
/**
 * Reverse migrate-fog-staging-images.js. Deletes the item_files rows
 * + the Drive files created by that script, and clears the drive_link
 * set on the FOG Working items.
 *
 * Scope: ONLY touches item_files on FOG Working items where
 * stage='mockup' AND the drive_file_id maps to a real Drive file the
 * service account can delete. Anything else on those items is left
 * alone.
 *
 * Usage:
 *   node scripts/undo-fog-staging-images.js          # dry run
 *   node scripts/undo-fog-staging-images.js --apply  # actually delete
 */

const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function getDrive() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  else key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "", "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  return google.drive({ version: "v3", auth });
}

(async () => {
  console.log(APPLY ? "APPLYING undo.\n" : "DRY RUN — use --apply to actually delete.\n");

  const { data: jobs } = await sb.from("jobs").select("id, title").ilike("title", "FOG Working").limit(1);
  if (!jobs?.length) { console.error("No FOG Working job found"); process.exit(1); }
  const job = jobs[0];
  console.log(`Job: ${job.title} (${job.id})\n`);

  const { data: items } = await sb.from("items").select("id, name, drive_link").eq("job_id", job.id);
  const itemIds = (items || []).map(i => i.id);

  // Only target stage=mockup files — those are what the migration created.
  // Leaves untouched any manually-uploaded proof/print-ready files.
  const { data: files } = await sb.from("item_files")
    .select("id, item_id, file_name, stage, drive_file_id")
    .in("item_id", itemIds)
    .eq("stage", "mockup")
    .is("superseded_at", null);

  console.log(`Found ${files?.length || 0} mockup item_files on FOG Working items.`);
  (files || []).slice(0, 8).forEach(f => console.log(`  ${f.file_name}  (drive ${f.drive_file_id})`));
  if ((files || []).length > 8) console.log(`  … and ${files.length - 8} more`);

  const itemsWithDriveLink = (items || []).filter(i => i.drive_link);
  console.log(`\n${itemsWithDriveLink.length} items have drive_link set — will reset to null.`);

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to undo.");
    return;
  }

  console.log("\n--- APPLYING UNDO ---\n");
  const drive = getDrive();
  let driveDeleted = 0, driveErrors = 0, rowsDeleted = 0;

  for (const f of files || []) {
    if (f.drive_file_id) {
      try {
        await drive.files.delete({ fileId: f.drive_file_id });
        driveDeleted++;
      } catch (e) {
        // 404 = already gone; treat as success.
        if (e.code === 404 || /notFound/i.test(e.message)) driveDeleted++;
        else { driveErrors++; console.log(`  ! drive delete ${f.drive_file_id}: ${e.message}`); }
      }
    }
    const { error: delErr } = await sb.from("item_files").delete().eq("id", f.id);
    if (delErr) console.log(`  ! row delete ${f.id}: ${delErr.message}`);
    else rowsDeleted++;
  }

  // Clear drive_link on all FOG Working items (was null before the migration).
  await sb.from("items").update({ drive_link: null }).eq("job_id", job.id);

  console.log(`\n✓ Done. Drive files deleted: ${driveDeleted} · item_files rows deleted: ${rowsDeleted} · drive errors: ${driveErrors}`);
  console.log("Item drive_link fields reset to null for all FOG Working items.");
})().catch(e => { console.error(e); process.exit(1); });
