-- Client-uploaded proposal items for the Staging tab in the Client Hub.
-- Lets clients upload existing mockups + arrange them in releases as a
-- planning sandbox before HPD has any project record. Proposals can sit
-- in the pool indefinitely or be staged into release buckets alongside
-- real OpsHub items. HPD reviews proposals and converts them into real
-- items when production is ready to start (Phase 2 of this build).

CREATE TABLE IF NOT EXISTS client_proposal_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name text NOT NULL,
  notes text,
  drive_file_id text,
  drive_link text,
  qty_estimate int,
  garment_type text,
  status text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'reviewing', 'converted', 'declined', 'archived')),
  converted_to_item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_proposal_items_client ON client_proposal_items(client_id);
CREATE INDEX IF NOT EXISTS idx_client_proposal_items_status ON client_proposal_items(client_id, status);

ALTER TABLE client_proposal_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can manage client_proposal_items" ON client_proposal_items;
CREATE POLICY "Authenticated users can manage client_proposal_items"
  ON client_proposal_items FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Extend release_items so a release entry can point to either a real
-- items.id OR a client_proposal_items.id. Exactly one must be set. The
-- old UNIQUE(item_id) constraint is replaced by partial unique indexes
-- so each item AND each proposal can each live in at most one release.
ALTER TABLE release_items
  ALTER COLUMN item_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS proposal_id uuid REFERENCES client_proposal_items(id) ON DELETE CASCADE;

ALTER TABLE release_items DROP CONSTRAINT IF EXISTS release_items_item_id_key;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'release_items_one_source_check'
  ) THEN
    ALTER TABLE release_items
      ADD CONSTRAINT release_items_one_source_check CHECK (
        (item_id IS NOT NULL AND proposal_id IS NULL)
        OR
        (item_id IS NULL AND proposal_id IS NOT NULL)
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS release_items_item_unique_idx
  ON release_items(item_id) WHERE item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS release_items_proposal_unique_idx
  ON release_items(proposal_id) WHERE proposal_id IS NOT NULL;
