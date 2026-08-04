#!/usr/bin/env node
// Drive reference auditor (read-only). Verifies every ACTIVE item_files
// drive_file_id still resolves in Drive — catalog thumbnails, galleries,
// and reorder-cart copies all reuse these IDs, so a file trashed or
// deleted in the Drive UI silently breaks them. Run occasionally, or
// after any manual Drive cleanup:
//   node scripts/verify-drive-refs.cjs
// "in trash" hits are recoverable (untrash via Drive UI or API PATCH
// {trashed:false}); 404s are permanently gone — supersede those rows.
// First run Aug 3 2026: restored 30 trashed, superseded 38 rows (32 404s).
const { createClient } = require("@supabase/supabase-js");
const { google } = require("googleapis");
require("dotenv").config({ path: "/Users/jonburrow/opshub/.env.local" });

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getToken() {
  let key;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_KEY) key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);
  else key = JSON.parse(Buffer.from(process.env.GOOGLE_SERVICE_ACCOUNT_KEY_B64 || "", "base64").toString("utf-8"));
  const auth = new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientOptions: { subject: "jon@housepartydistro.com" },
  });
  const client = await auth.getClient();
  return (await client.getAccessToken()).token;
}

async function pageAll(q) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q().range(from, from + 999).order("id");
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

(async () => {
  const rows = await pageAll(() => sb.from("item_files")
    .select("id, item_id, drive_file_id, file_name, stage, items(name, jobs(job_number, clients(name)))")
    .is("superseded_at", null));
  const byDrive = new Map();
  for (const r of rows) {
    if (!r.drive_file_id) continue;
    if (!byDrive.has(r.drive_file_id)) byDrive.set(r.drive_file_id, []);
    byDrive.get(r.drive_file_id).push(r);
  }
  console.log(`Active item_files rows: ${rows.length} · unique drive files: ${byDrive.size} · rows with NO drive_file_id: ${rows.filter(r => !r.drive_file_id).length}`);

  const token = await getToken();
  const ids = Array.from(byDrive.keys());
  const bad = [];
  let checked = 0, trashed = 0;
  const CONC = 15;
  for (let i = 0; i < ids.length; i += CONC) {
    await Promise.all(ids.slice(i, i + CONC).map(async (id) => {
      try {
        const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=id,name,trashed`, {
          headers: { Authorization: `Bearer ${token}` } });
        if (r.status === 404) { bad.push({ id, why: "404 (deleted or no access)" }); }
        else if (!r.ok) { bad.push({ id, why: `HTTP ${r.status}` }); }
        else {
          const j = await r.json();
          if (j.trashed) { trashed++; bad.push({ id, why: "in trash" }); }
        }
      } catch (e) { bad.push({ id, why: `fetch error: ${e.message}` }); }
      checked++;
    }));
    if (checked % 300 < CONC) console.log(`  …checked ${checked}/${ids.length}`);
  }
  console.log(`\nChecked ${checked}. Dead/trashed: ${bad.length} (${trashed} in trash)`);
  for (const b of bad) {
    const refs = byDrive.get(b.id) || [];
    for (const r of refs) {
      const it = r.items || {};
      const job = it.jobs || {};
      console.log(`  ✗ ${b.why} · ${job.clients?.name || "?"} · ${job.job_number || "?"} · ${it.name || "?"} · [${r.stage}] ${r.file_name}`);
    }
  }
  if (!bad.length) console.log("All referenced Drive files resolve. ✓");
})();
