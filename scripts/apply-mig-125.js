const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/125_is_test_flag.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { data, error: vErr } = await sb.from("jobs").select("job_number, is_test").eq("is_test", true);
  if (vErr) { console.error("Verify failed:", vErr.message); process.exit(1); }
  console.log("✓ Migration 125 applied. Flagged test jobs:", (data || []).map(j => j.job_number).join(", ") || "(none)");
})().catch(e => { console.error(e); process.exit(1); });
