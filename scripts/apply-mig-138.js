#!/usr/bin/env node
/** Apply migration 138 — history_sales + history_vendor_costs. Safe to re-run. */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/138_history_tables.sql", "utf8");
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) { console.error("RPC failed — run in SQL editor:\n", error.message); process.exit(1); }
  console.log("✓ Migration 138 applied: history_sales + history_vendor_costs.");
})().catch(e => { console.error(e); process.exit(1); });
