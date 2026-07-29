#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/151_unarchive_kys_tee.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  const { data: it } = await supabase.from("items").select("name, archived_at").eq("id", "fa11456e-b059-47e2-b842-c52d97fe9f94").single();
  console.log("✓ Migration 151 applied:", it.name, "archived_at =", it.archived_at);
})();
