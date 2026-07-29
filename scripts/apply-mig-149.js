#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/149_retire_item_eta_fields.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  const { count: a } = await supabase.from("items").select("id", { count: "exact", head: true }).not("expected_arrival", "is", null);
  const { count: b } = await supabase.from("items").select("id", { count: "exact", head: true }).not("client_eta", "is", null);
  console.log(`✓ Migration 149 applied: retired item ETA fields wiped (remaining: expected_arrival=${a}, client_eta=${b}).`);
})();
