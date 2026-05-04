-- Ecomm department foundation. Extends fulfillment_projects to host the
-- ecomm-side fields (mode, platform, store, dates, buffer, listed_by) and
-- adds the item_store_listings junction so OpsHub items can be linked to
-- specific platform variants across multiple stores.
--
-- Three modes:
--   preorder  — Shopify variant qtys count from 0 down as orders come in.
--               Close + tally + buffer fires production.
--   drop      — Pre-produced inventory listed for sale; sells until empty.
--   always_on — Ongoing store with replenishment driven by velocity alerts.
--
-- The Ecomm dashboard at /ecomm reads fulfillment_projects WHERE mode IS NOT NULL.
-- The /fulfillment view continues to show projects with mode IS NULL (the
-- legacy/manual fulfillment use case) so the two surfaces don't conflict.

ALTER TABLE fulfillment_projects
  ADD COLUMN IF NOT EXISTS mode text CHECK (mode IS NULL OR mode IN ('preorder', 'drop', 'always_on')),
  ADD COLUMN IF NOT EXISTS platform text CHECK (platform IS NULL OR platform IN ('shopify', 'bigcommerce', 'bigcartel', 'other')),
  ADD COLUMN IF NOT EXISTS store_account text,
  ADD COLUMN IF NOT EXISTS open_date date,
  ADD COLUMN IF NOT EXISTS close_date date,
  ADD COLUMN IF NOT EXISTS target_ship_date date,
  ADD COLUMN IF NOT EXISTS buffer_pct numeric(5,2) DEFAULT 5.0,
  ADD COLUMN IF NOT EXISTS listed_by text CHECK (listed_by IS NULL OR listed_by IN ('client', 'hpd'));

-- Junction: which OpsHub items live on which platform stores. One row per
-- (item, store, variant) so a single OpsHub item can simultaneously live in
-- multiple stores with different variant IDs and different thresholds.
-- Replenishment alerts read this table.
CREATE TABLE IF NOT EXISTS item_store_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  ecomm_project_id uuid REFERENCES fulfillment_projects(id) ON DELETE SET NULL,
  platform text NOT NULL CHECK (platform IN ('shopify', 'bigcommerce', 'bigcartel', 'other')),
  store_account text NOT NULL,
  product_id text,
  variant_id text,
  size text,
  color text,
  sell_price numeric(10,2),
  low_stock_threshold int,
  production_lead_days int,
  current_qty int,
  current_qty_synced_at timestamptz,
  listed_at timestamptz,
  listed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_store_listings_item     ON item_store_listings(item_id);
CREATE INDEX IF NOT EXISTS idx_item_store_listings_project  ON item_store_listings(ecomm_project_id);
CREATE INDEX IF NOT EXISTS idx_item_store_listings_platform ON item_store_listings(platform, store_account);
CREATE INDEX IF NOT EXISTS idx_item_store_listings_variant  ON item_store_listings(platform, variant_id) WHERE variant_id IS NOT NULL;

ALTER TABLE item_store_listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage item_store_listings" ON item_store_listings;
CREATE POLICY "Authenticated users can manage item_store_listings"
  ON item_store_listings FOR ALL TO authenticated USING (true) WITH CHECK (true);
