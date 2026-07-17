const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/124_inbound_tracking.sql", "utf8");
  const { error } = await sb.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  const { error: vErr } = await sb.from("tracking_events").select("id").limit(1);
  if (vErr) { console.error("Verify failed:", vErr.message); process.exit(1); }
  const { error: v2 } = await sb.from("shipments").select("id, easypost_tracker_id, delivered_at").limit(1);
  if (v2) { console.error("Verify shipments cols failed:", v2.message); process.exit(1); }
  console.log("✓ Migration 124 applied: tracking_events + shipments tracking columns");
})().catch(e => { console.error(e); process.exit(1); });
