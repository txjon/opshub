#!/usr/bin/env node
// Apply migration 103 — bill_group_id + bill_attachments + bill-invoices bucket.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const sql = fs.readFileSync("supabase/migrations/103_bill_attachments.sql", "utf8");
  const { error } = await supabase.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) { console.error("Apply failed:", error.message); process.exit(1); }
  console.log("✓ Migration 103 applied: bill_group_id + bill_attachments + bill-invoices bucket.");
  // verify
  const { error: e2 } = await supabase.from("bill_attachments").select("id").limit(1);
  console.log("bill_attachments table:", e2 ? "ERR " + e2.message : "ok");
})().catch(e => { console.error(e); process.exit(1); });
