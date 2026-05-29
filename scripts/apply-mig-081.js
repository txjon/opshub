#!/usr/bin/env node
/**
 * Apply migration 081 — bulk postage mode.
 * One-shot. Safe to re-run (ADD COLUMN IF NOT EXISTS + idempotent constraint).
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
      ADD COLUMN IF NOT EXISTS postage_mode text NOT NULL DEFAULT 'per_shipment';

    ALTER TABLE shipstation_reports
      DROP CONSTRAINT IF EXISTS shipstation_reports_postage_mode_check;

    ALTER TABLE shipstation_reports
      ADD CONSTRAINT shipstation_reports_postage_mode_check
      CHECK (postage_mode IN ('per_shipment', 'bulk'));
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this SQL in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 081 applied: shipstation_reports.postage_mode (default 'per_shipment').");
})().catch(e => { console.error(e); process.exit(1); });
