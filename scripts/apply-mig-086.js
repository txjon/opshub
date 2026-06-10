#!/usr/bin/env node
/**
 * Apply migration 086 — allow report_type='fulfillment' on shipstation_reports.
 * One-shot. exec_sql RPC may not be available; if so this prints the SQL to
 * run in the Supabase SQL editor. Purely additive (widens a CHECK constraint).
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = `
    ALTER TABLE shipstation_reports
      DROP CONSTRAINT IF EXISTS shipstation_reports_report_type_check;
    ALTER TABLE shipstation_reports
      ADD CONSTRAINT shipstation_reports_report_type_check
      CHECK (report_type IN ('sales', 'postage', 'combined', 'fulfillment'));
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 086 applied: report_type now allows 'fulfillment'.");
})().catch(e => { console.error(e); process.exit(1); });
