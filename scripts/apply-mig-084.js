#!/usr/bin/env node
/**
 * Apply migration 084 — fulfillment_projects.open_date/close_date → timestamptz.
 * One-shot. exec_sql RPC isn't available in this project, so this will most
 * likely print the SQL for you to run in the Supabase SQL editor.
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = `
    ALTER TABLE fulfillment_projects
      ALTER COLUMN open_date  TYPE timestamptz USING open_date::timestamptz,
      ALTER COLUMN close_date TYPE timestamptz USING close_date::timestamptz;
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 084 applied: open_date/close_date are now timestamptz.");
})().catch(e => { console.error(e); process.exit(1); });
