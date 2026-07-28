#!/usr/bin/env node
// Apply migration 148 — THE LAB Room 2 (designer lane): lab_work_orders +
// lab_wo_messages. Isolated lab_* tables, service-role only.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/148_lab_room2.sql", "utf8");
  const { error } = await supabase.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  console.log("✓ Migration 148 applied: lab_work_orders + lab_wo_messages.");
  const a = await supabase.from("lab_work_orders").select("id").limit(1);
  const b = await supabase.from("lab_wo_messages").select("id").limit(1);
  console.log("lab_work_orders:", a.error ? "ERR " + a.error.message : "ok");
  console.log("lab_wo_messages:", b.error ? "ERR " + b.error.message : "ok");
})().catch(e => { console.error(e); process.exit(1); });
