-- 029_fulfillment_projects.sql
-- Fulfillment projects (Distro side) with daily logs

CREATE TABLE IF NOT EXISTS fulfillment_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES clients(id),
  name TEXT NOT NULL,
  store_name TEXT,
  status TEXT DEFAULT 'staging' CHECK (status IN ('staging', 'active', 'complete')),
  notes TEXT,
  total_units INTEGER DEFAULT 0,
  source_job_id UUID REFERENCES jobs(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS fulfillment_daily_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES fulfillment_projects(id) ON DELETE CASCADE,
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  starting_orders INTEGER DEFAULT 0,
  orders_shipped INTEGER DEFAULT 0,
  remaining_orders INTEGER DEFAULT 0,
  notes TEXT,
  logged_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(project_id, log_date)
);

ALTER TABLE fulfillment_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE fulfillment_daily_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage fulfillment_projects"
  ON fulfillment_projects FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage fulfillment_daily_logs"
  ON fulfillment_daily_logs FOR ALL TO authenticated USING (true) WITH CHECK (true);
