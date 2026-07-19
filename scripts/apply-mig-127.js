const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/127_decorator_default_ship_method.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { error: v1 } = await sb.from("decorators").select("default_ship_method").limit(1);
  if (v1) { console.error("Verify failed:", v1.message); process.exit(1); }
  console.log("✓ Migration 127 applied: default_ship_method on decorators");
})().catch(e => { console.error(e); process.exit(1); });
