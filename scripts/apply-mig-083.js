#!/usr/bin/env node
/**
 * Apply migration 083 — items.proof_spec (editable proof source of truth).
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
    ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_spec jsonb;
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this SQL in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 083 applied: items.proof_spec.");
})().catch(e => { console.error(e); process.exit(1); });
