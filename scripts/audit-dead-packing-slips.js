#!/usr/bin/env node
/**
 * READ-ONLY audit: find item_files packing-slip rows whose Google Drive file
 * no longer exists (deleted from Drive directly, so the DB row is orphaned
 * and /receiving2 renders a dead "slip" link).
 *
 * Checks every stage='packing_slip' row with a drive_link against the Drive
 * API (404 = gone, trashed = in Drive trash). Prints a report + the DELETE
 * SQL to run in the Supabase editor. Makes NO writes.
 *
 * Usage: node scripts/audit-dead-packing-slips.js
 */
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
require("dotenv").config({ path: ".env.local" });

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

// drive_link formats vary (…/file/d/<id>/view, ?id=<id>); prefer drive_file_id column
function fileIdOf(row) {
  if (row.drive_file_id) return row.drive_file_id;
  const m = (row.drive_link || "").match(/\/d\/([\w-]{20,})|[?&]id=([\w-]{20,})/);
  return m ? (m[1] || m[2]) : null;
}

(async () => {
  const { data: rows, error } = await sb
    .from("item_files")
    .select("id, item_id, file_name, drive_link, drive_file_id, created_at, items(name, jobs(job_number, clients(name)))")
    .eq("stage", "packing_slip")
    .not("drive_link", "is", null)
    .order("created_at", { ascending: false });
  if (error) { console.error("DB error:", error.message); process.exit(1); }
  if (!rows?.length) { console.log("No packing_slip rows with a drive_link. Nothing to audit."); return; }

  console.log(`Checking ${rows.length} packing-slip file rows against Google Drive…\n`);
  const drive = getDrive();
  const dead = [], trashed = [], alive = [], unknown = [];

  for (const r of rows) {
    const fid = fileIdOf(r);
    const who = `${r.items?.jobs?.clients?.name || "?"} · ${r.items?.jobs?.job_number || "?"} · ${r.items?.name || "?"} · "${r.file_name || "slip"}" (${(r.created_at || "").slice(0, 10)})`;
    if (!fid) { unknown.push(r); console.log(`  ?? no file id  ${who}`); continue; }
    try {
      const res = await drive.files.get({ fileId: fid, fields: "id, trashed", supportsAllDrives: true });
      if (res.data.trashed) { trashed.push(r); console.log(`  🗑  in trash    ${who}`); }
      else { alive.push(r); console.log(`  ok             ${who}`); }
    } catch (e) {
      const code = e?.code || e?.response?.status;
      if (code === 404) { dead.push(r); console.log(`  ✗  GONE        ${who}`); }
      else { unknown.push(r); console.log(`  ?? err ${code}   ${who}`); }
    }
  }

  console.log(`\n— Summary —`);
  console.log(`alive: ${alive.length}   trashed: ${trashed.length}   gone (404): ${dead.length}   unknown: ${unknown.length}`);

  const toDelete = [...dead, ...trashed];
  if (toDelete.length) {
    console.log(`\nSQL to clean up (run in Supabase editor) — removes the ${toDelete.length} dead/trashed rows:\n`);
    console.log(`delete from item_files where id in (\n  ${toDelete.map(r => `'${r.id}'`).join(",\n  ")}\n);`);
  } else {
    console.log("\nNo dead rows found — nothing to delete.");
  }
})().catch(e => { console.error(e); process.exit(1); });
