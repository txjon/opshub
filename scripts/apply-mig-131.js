const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/131_art_request_per_item.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  await new Promise(r => setTimeout(r, 1500));
  const { error: v1 } = await sb.from("art_requests").select("quoted_items").limit(1);
  if (v1) { console.error("Verify failed:", v1.message); process.exit(1); }
  console.log("✓ Migration 131 applied: art_requests.quoted_items");
})().catch(e => { console.error(e); process.exit(1); });
