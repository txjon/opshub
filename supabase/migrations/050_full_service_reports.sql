-- Full Service ("combined") reports — one shipstation_reports row that
-- holds both sales and postage data so the client gets one invoice
-- covering both halves of HPD's monthly fulfillment.
--
-- Data layout for report_type='combined':
--   sales side  → existing line_items / totals / hpd_fee_pct columns
--                 (hpd_fee_pct is the sales fee % for combined)
--   postage side → new postage_line_items / postage_totals / postage_markup_pct
--                 columns + existing per_package_fee
--
-- Sales-only and postage-only reports are unchanged (postage-only still
-- uses hpd_fee_pct for its single markup rate, line_items for its
-- shipments, etc.). Existing readers stay untouched; combined readers
-- look at the new columns when report_type='combined'.

ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS postage_line_items jsonb,
  ADD COLUMN IF NOT EXISTS postage_totals jsonb,
  ADD COLUMN IF NOT EXISTS postage_markup_pct numeric(5, 4);

ALTER TABLE shipstation_reports
  DROP CONSTRAINT IF EXISTS shipstation_reports_report_type_check;

ALTER TABLE shipstation_reports
  ADD CONSTRAINT shipstation_reports_report_type_check
  CHECK (report_type IN ('sales', 'postage', 'combined'));
