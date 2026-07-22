#!/usr/bin/env node
/** Apply migration 137 — products table + items.product_id. Safe to re-run. */
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
require("dotenv").config({ path: ".env.local" });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/137_products.sql", "utf8");
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) { console.error("RPC failed — run in SQL editor:\n", error.message); process.exit(1); }
  console.log("✓ Migration 137 applied: products + items.product_id (RLS house pattern).");
})().catch(e => { console.error(e); process.exit(1); });
