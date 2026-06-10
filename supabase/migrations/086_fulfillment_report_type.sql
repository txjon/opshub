-- Fulfillment-only ShipStation report.
-- For clients who run their own ShipStation and pay their own postage:
-- we bill ONLY the per-package fulfillment fee (shipments x rate), no
-- postage cost, no markup, no sales. Stored like a per-shipment postage
-- report with postage values zeroed; totals.fulfillment is the invoice.
ALTER TABLE shipstation_reports
  DROP CONSTRAINT IF EXISTS shipstation_reports_report_type_check;

ALTER TABLE shipstation_reports
  ADD CONSTRAINT shipstation_reports_report_type_check
  CHECK (report_type IN ('sales', 'postage', 'combined', 'fulfillment'));
