// Upload one dump file to the private `db-backups` bucket, then delete
// backups older than 60 days. Runs in GitHub Actions (see db-backup.yml).
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const RETAIN_DAYS = 60;
(async () => {
  const file = process.argv[2];
  if (!file || !fs.existsSync(file)) { console.error("dump file missing"); process.exit(1); }
  const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const name = path.basename(file);
  const { error } = await sb.storage.from("db-backups").upload(name, fs.readFileSync(file), { contentType: "application/octet-stream", upsert: false });
  if (error) { console.error("upload failed:", error.message); process.exit(1); }
  const size = (fs.statSync(file).size / 1048576).toFixed(1);
  console.log(`uploaded db-backups/${name} (${size} MB)`);
  const { data: list } = await sb.storage.from("db-backups").list("", { limit: 1000 });
  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  const old = (list || []).filter(f => f.name.startsWith("opshub_") && new Date(f.created_at).getTime() < cutoff).map(f => f.name);
  if (old.length) { const { error: dErr } = await sb.storage.from("db-backups").remove(old); console.log(dErr ? "prune failed: " + dErr.message : `pruned ${old.length} older than ${RETAIN_DAYS}d`); }
  console.log(`${(list || []).length - old.length} backups retained`);
})();
