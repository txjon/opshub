-- Per-half period labels for Full Service (combined) reports.
--
-- A combined report's two halves can cover different date ranges — e.g.
-- product sales for April but bulk postage purchased Mar 27–May 28. The
-- existing period_label stays the INVOICE period (report title, QB memo,
-- email subject, filename, list/portal). These two optional columns let
-- each half show its own range on its section + its QB line:
--   sales half   → sales_period_label   ?? period_label
--   postage half → postage_period_label ?? period_label
--
-- Null = "use the invoice period" (every existing report + all single-type
-- reports), so readers fall back to period_label and nothing changes for
-- sales-only / postage-only reports.

ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS sales_period_label text,
  ADD COLUMN IF NOT EXISTS postage_period_label text;
