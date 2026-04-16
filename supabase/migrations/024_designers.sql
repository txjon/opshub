-- Designers: external design team, portal-based access
-- Jon's team uses one designer team serving both HPD and touring company.
-- Each deployment has its own designers table.

CREATE TABLE IF NOT EXISTS designers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text,
  portal_token text UNIQUE NOT NULL,
  active boolean DEFAULT true,
  notes text,
  created_at timestamptz DEFAULT now(),
  last_active_at timestamptz
);

CREATE INDEX IF NOT EXISTS designers_portal_token_idx ON designers(portal_token);
CREATE INDEX IF NOT EXISTS designers_active_idx ON designers(active);

-- Link briefs to specific designers
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS assigned_designer_id uuid REFERENCES designers(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS art_briefs_assigned_designer_idx ON art_briefs(assigned_designer_id);

-- Track when brief was sent to designer (separate from state changes)
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS sent_to_designer_at timestamptz;

-- RLS: authenticated users manage designers. Portal access via service role API.
ALTER TABLE designers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users manage designers" ON designers FOR ALL USING (auth.uid() IS NOT NULL);
