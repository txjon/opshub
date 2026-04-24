ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS report_type text NOT NULL DEFAULT 'sales';

ALTER TABLE shipstation_reports
  DROP CONSTRAINT IF EXISTS shipstation_reports_report_type_check;

ALTER TABLE shipstation_reports
  ADD CONSTRAINT shipstation_reports_report_type_check
  CHECK (report_type IN ('sales', 'postage'));
