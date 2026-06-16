#!/usr/bin/env node
/**
 * Apply migration 089 — company_item_types table + items.qb_item_type column,
 * then seed DMD's item types (Tops, Bottoms, Jacket). Additive; no behavior
 * change for HPD/IHM. exec_sql RPC; prints SQL if unavailable.
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const fs = require("fs");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = fs.readFileSync("supabase/migrations/089_company_item_types.sql", "utf8");
  const { error } = await supabase.rpc("exec_sql", { sql: sql + "\nNOTIFY pgrst, 'reload schema';" });
  if (error) {
    console.error("Could not apply via RPC. Run the SQL in supabase/migrations/089_company_item_types.sql manually.\n", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 089 applied: company_item_types + items.qb_item_type.");

  // Seed DMD's item types.
  const { data: dmd } = await supabase.from("companies").select("id").eq("slug", "dmd").single();
  if (!dmd) { console.error("DMD company row not found — run scripts/seed-dmd.cjs first."); process.exit(1); }
  const types = [["Tops", 0], ["Bottoms", 1], ["Jacket", 2]];
  const rows = types.map(([name, sort_order]) => ({ company_id: dmd.id, name, sort_order }));
  const { data, error: sErr } = await supabase.from("company_item_types").upsert(rows, { onConflict: "company_id,name" }).select("name");
  if (sErr) { console.error("Seed failed:", sErr.message); process.exit(1); }
  console.log("✓ Seeded DMD item types:", (data || []).map(r => r.name).join(", "));
})().catch(e => { console.error(e); process.exit(1); });
