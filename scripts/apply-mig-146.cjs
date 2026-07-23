const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/146_item_ship_est.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  // verify the column exists
  const { error: qErr } = await sb.from("items").select("id, ship_est").limit(1);
  if (qErr) { console.error("Verify failed:", qErr.message); process.exit(1); }
  console.log("✓ Migration 146 applied: items.ship_est (per-item ship/exit-factory date)");
})().catch(e => { console.error(e); process.exit(1); });
