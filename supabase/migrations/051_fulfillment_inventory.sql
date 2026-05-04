-- Multi-source inventory for fulfillment projects.
-- A fulfillment project (Shopify drop, monthly subscription, etc.) can pull
-- inventory from any combination of:
--   labs_item        — items received from a Labs production job
--   outside_shipment — outside shipments routed to staging
--   preexisting      — pre-existing warehouse inventory (no upstream record)
--
-- Per-line webstore_entered_at flips the line from "Staging" to "Ready"
-- once the warehouse team has keyed the qtys into the Shopify store.
-- That flag drives the future Staging vs Ready split on the fulfillment
-- page; today the existing UI ignores it so adding it is non-breaking.

CREATE TABLE IF NOT EXISTS fulfillment_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES fulfillment_projects(id) ON DELETE CASCADE,
  source_type text NOT NULL CHECK (source_type IN ('labs_item', 'outside_shipment', 'preexisting')),
  source_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  source_shipment_id uuid REFERENCES outside_shipments(id) ON DELETE SET NULL,
  description text,
  qtys jsonb DEFAULT '{}'::jsonb,
  notes text,
  webstore_entered_at timestamptz,
  webstore_entered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sort_order int DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT fulfillment_inventory_source_consistency CHECK (
    (source_type = 'labs_item'        AND source_item_id IS NOT NULL AND source_shipment_id IS NULL)
    OR
    (source_type = 'outside_shipment' AND source_shipment_id IS NOT NULL AND source_item_id IS NULL)
    OR
    (source_type = 'preexisting'      AND source_item_id IS NULL AND source_shipment_id IS NULL AND description IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_project ON fulfillment_inventory(project_id);
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_item    ON fulfillment_inventory(source_item_id) WHERE source_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fulfillment_inventory_ship    ON fulfillment_inventory(source_shipment_id) WHERE source_shipment_id IS NOT NULL;

ALTER TABLE fulfillment_inventory ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage fulfillment_inventory" ON fulfillment_inventory;
CREATE POLICY "Authenticated users can manage fulfillment_inventory"
  ON fulfillment_inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Backfill: every existing fulfillment_projects.source_job_id becomes one
-- labs_item line per received item on that job. Skip if a row already
-- exists (idempotent on rerun). Qtys are NOT snapshotted for labs_item
-- lines — they read live from items.received_qtys − items.sample_qtys
-- on the fulfillment page so receiver corrections flow through.
INSERT INTO fulfillment_inventory (project_id, source_type, source_item_id, qtys, sort_order)
SELECT
  fp.id,
  'labs_item',
  i.id,
  '{}'::jsonb,
  COALESCE(i.sort_order, 0)
FROM fulfillment_projects fp
JOIN items i ON i.job_id = fp.source_job_id
WHERE fp.source_job_id IS NOT NULL
  AND i.received_at_hpd = true
  AND NOT EXISTS (
    SELECT 1 FROM fulfillment_inventory fi
    WHERE fi.project_id = fp.id AND fi.source_item_id = i.id
  );
