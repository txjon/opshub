const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/126_qb_paid_status.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { error: v1 } = await sb.from("cost_entries").select("qb_paid_at").limit(1);
  const { error: v2 } = await sb.from("contractor_pay_runs").select("qb_paid_at").limit(1);
  if (v1 || v2) { console.error("Verify failed:", v1?.message || v2?.message); process.exit(1); }
  console.log("✓ Migration 126 applied: qb_paid_at on cost_entries + contractor_pay_runs");
})().catch(e => { console.error(e); process.exit(1); });
