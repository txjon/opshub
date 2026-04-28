#!/usr/bin/env node
/**
 * Apply migration 044 — client payment method flags.
 * One-shot. Safe to re-run (uses ADD COLUMN IF NOT EXISTS).
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = `
    ALTER TABLE clients
      ADD COLUMN IF NOT EXISTS allow_cc boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS allow_ach boolean NOT NULL DEFAULT true;
  `;
  const { data, error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    // If exec_sql RPC doesn't exist, surface a clear instruction.
    console.error("Could not apply via RPC. Run this SQL in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 044 applied: clients.allow_cc, clients.allow_ach (default true).");
})().catch(e => { console.error(e); process.exit(1); });
