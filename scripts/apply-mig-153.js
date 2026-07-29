#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { error } = await supabase.rpc("exec_sql", { sql: fs.readFileSync("supabase/migrations/153_doc_links.sql", "utf8") });
  if (error) { console.error("RPC failed:\n", error.message); process.exit(1); }
  const { data: rows } = await supabase.from("doc_links").select("token, doc, label");
  for (const r of rows) console.log(r.token, "→", r.doc);
  console.log("✓ Migration 153 applied.");
})();
