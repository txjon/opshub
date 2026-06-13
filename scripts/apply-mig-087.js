#!/usr/bin/env node
/**
 * Apply migration 087 — jobs.is_inventory flag.
 *
 * Purely additive (new boolean column, default false → ZERO behavior change
 * until the code reads it). Also flags the one known inventory job
 * (HPD-2606-023 "Blank Camo Hats", $30K bulk blank buy) so dev P&L is correct
 * the moment the code lands. exec_sql RPC; if unavailable, prints the SQL.
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = `
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_inventory boolean NOT NULL DEFAULT false;
    COMMENT ON COLUMN jobs.is_inventory IS 'Bulk stock/blank purchase, not a client sale. Excluded from all P&L rollups; cost rides the future jobs that decorate+sell the stock.';
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 087 applied: jobs.is_inventory added (default false).");

  // Flag the one known inventory job so dev numbers are immediately correct.
  // (No effect on prod until the reading code ships — prod code ignores the column.)
  const { data, error: upErr } = await supabase
    .from("jobs")
    .update({ is_inventory: true })
    .eq("job_number", "HPD-2606-023")
    .select("job_number, title, is_inventory");
  if (upErr) { console.error("Flag update failed:", upErr.message); process.exit(1); }
  console.log("✓ Flagged as inventory:", JSON.stringify(data));
})().catch(e => { console.error(e); process.exit(1); });
