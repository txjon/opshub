const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/116_item_size_subs.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  // verify the column exists by selecting it
  const { error: vErr } = await sb.from("items").select("id, size_subs").limit(1);
  if (vErr) { console.error("Verify failed:", vErr.message); process.exit(1); }
  console.log("✓ Migration 116 applied: items.size_subs jsonb");
})().catch(e => { console.error(e); process.exit(1); });
