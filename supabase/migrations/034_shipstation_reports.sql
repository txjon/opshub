-- ── ShipStation Sales Report ──
-- Internal tool: Jon uploads a ShipStation CSV for a fulfillment client,
-- selects which line items to include, types unit costs, and generates a
-- branded PDF. Each run is stored so we can re-download any month without
-- re-uploading the CSV. Fulfillment/postage report deferred.

-- Per-client HPD fee rate. Most common is 20% but every client is a different deal.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS hpd_fee_pct numeric(5, 4) DEFAULT 0.20;

-- Persistent unit costs. Typing unit costs per SKU is the main manual step;
-- storing them means next month pre-fills what Jon entered last month.
CREATE TABLE IF NOT EXISTS shipstation_sku_costs (
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  sku text NOT NULL,
  description text,
  unit_cost numeric(12, 4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (client_id, sku)
);

-- Generated reports. One row per run; everything needed to re-render the
-- PDF lives on the row so the detail page doesn't need the source CSV.
CREATE TABLE IF NOT EXISTS shipstation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
  period_label text NOT NULL,
  hpd_fee_pct numeric(5, 4) NOT NULL,
  -- rows that made it into the report, in display order.
  -- shape: [{ sku, description, qty_sold, product_sales, unit_cost }]
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- full parsed CSV kept for auditability — includes rows Jon un-checked
  -- so a regenerate / "I shouldn't have excluded X" is possible without
  -- re-uploading. shape: [{ sku, description, qty_sold, product_sales, included }]
  source_rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb, -- { qty, sales, cost, net, fee, profit }
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id)
);

CREATE INDEX IF NOT EXISTS shipstation_reports_client_idx
  ON shipstation_reports(client_id, created_at DESC);

-- RLS: internal tool. Any authenticated team member can read + write.
ALTER TABLE shipstation_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipstation_sku_costs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS shipstation_reports_all ON shipstation_reports;
CREATE POLICY shipstation_reports_all ON shipstation_reports
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS shipstation_sku_costs_all ON shipstation_sku_costs;
CREATE POLICY shipstation_sku_costs_all ON shipstation_sku_costs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
