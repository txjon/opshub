-- Shipping route per job (set during setup)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS shipping_route text DEFAULT 'ship_through' CHECK (shipping_route IN ('drop_ship', 'ship_through', 'stage'));

-- Fulfillment status (job-level, for stage route)
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fulfillment_status text CHECK (fulfillment_status IN ('staged', 'packing', 'shipped'));
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS fulfillment_tracking text;

-- Item received at HPD flag
ALTER TABLE items ADD COLUMN IF NOT EXISTS received_at_hpd boolean DEFAULT false;
ALTER TABLE items ADD COLUMN IF NOT EXISTS received_at_hpd_at timestamptz;
