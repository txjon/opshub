const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/145_lab_studio.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  console.log("✓ Migration 145 applied: lab_clients / lab_threads / lab_messages");

  // The isolated public bucket for design images (idempotent).
  const BUCKET = "lab-studio";
  const { data: list } = await sb.storage.listBuckets();
  if (!(list || []).some(b => b.name === BUCKET)) {
    const { error: bErr } = await sb.storage.createBucket(BUCKET, { public: true });
    if (bErr) { console.error("Bucket create failed:", bErr.message); process.exit(1); }
    console.log("✓ Storage bucket 'lab-studio' created (public)");
  } else {
    console.log("• Storage bucket 'lab-studio' already exists");
  }
})().catch(e => { console.error(e); process.exit(1); });
