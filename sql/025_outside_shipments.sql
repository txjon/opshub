-- 025_outside_shipments.sql
-- Outside/unexpected shipments received at warehouse (not tied to a project)

CREATE TABLE IF NOT EXISTS outside_shipments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  carrier TEXT,
  tracking TEXT,
  sender TEXT,
  description TEXT,
  condition TEXT DEFAULT 'good',
  notes TEXT,
  job_id UUID REFERENCES jobs(id),
  received_by UUID REFERENCES auth.users(id),
  received_at TIMESTAMPTZ DEFAULT now(),
  resolved BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- RLS
ALTER TABLE outside_shipments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage outside_shipments"
  ON outside_shipments FOR ALL TO authenticated USING (true) WITH CHECK (true);
