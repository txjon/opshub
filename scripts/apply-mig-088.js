#!/usr/bin/env node
/**
 * Apply migration 088 — preorder_products.image_url.
 *
 * Additive (new nullable text column). Captures the Shopify product image URL
 * on import so push-to-production can auto-upload it to Drive as the item
 * mockup. ZERO behavior change until the import/push code reads it. exec_sql
 * RPC; if unavailable, prints the SQL.
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

(async () => {
  const sql = `
    ALTER TABLE preorder_products ADD COLUMN IF NOT EXISTS image_url text;
    COMMENT ON COLUMN preorder_products.image_url IS 'Public Shopify CDN product image (Image Src from the products export). Auto-uploaded to Drive as the item mockup on push-to-production.';
  `;
  const { error } = await supabase.rpc("exec_sql", { sql });
  if (error) {
    console.error("Could not apply via RPC. Run this in the Supabase SQL editor:\n");
    console.error(sql);
    console.error("\nError detail:", error.message);
    process.exit(1);
  }
  console.log("✓ Migration 088 applied: preorder_products.image_url added (nullable).");
})().catch(e => { console.error(e); process.exit(1); });
