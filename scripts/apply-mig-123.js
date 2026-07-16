const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/123_vendor_transit_defaults.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { error: vErr } = await sb.from("decorators").select("id, transit_defaults").limit(1);
  if (vErr) { console.error("Verify failed:", vErr.message); process.exit(1); }
  console.log("✓ Migration 123 applied: decorators.transit_defaults jsonb");
})().catch(e => { console.error(e); process.exit(1); });
