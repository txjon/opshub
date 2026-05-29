#!/usr/bin/env node
/**
 * Apply migration 082 — per-half period labels for combined reports.
 * One-shot. Safe to re-run (ADD COLUMN IF NOT EXISTS).
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
      ADD COLUMN IF NOT EXISTS sales_period_label text,
      ADD COLUMN IF NOT EXISTS postage_period_label text;
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this SQL in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 082 applied: shipstation_reports.sales_period_label, postage_period_label.");
})().catch(e => { console.error(e); process.exit(1); });
