#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/150_fog_client_promises.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  const { data: rows } = await supabase.from("items").select("name, client_eta, jobs(job_number)").not("client_eta", "is", null).order("client_eta");
  for (const r of rows) console.log(r.jobs.job_number, r.name, "→", r.client_eta);
  console.log(`✓ Migration 150 applied: ${rows.length} promises set.`);
})();
