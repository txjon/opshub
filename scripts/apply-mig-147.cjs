const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/147_proof_sent_at.sql","utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { error: q } = await sb.from("items").select("id, proof_sent_at").limit(1);
  if (q) { console.error("Verify failed:", q.message); process.exit(1); }
  console.log("✓ Migration 147 applied: items.proof_sent_at");
})().catch(e => { console.error(e); process.exit(1); });
