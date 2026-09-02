#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/169_hub_default_on.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  console.log("✓ Migration 169 applied.");
})();
