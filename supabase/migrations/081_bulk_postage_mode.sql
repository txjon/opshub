-- Bulk postage mode — for clients where HPD buys postage in BULK (account
-- top-ups) rather than per shipment, and bills the client a pure
-- pass-through reimbursement of what was spent.
--
-- The per-shipment postage report (postage_mode='per_shipment', the
-- default) is unchanged: one row per package, markup applied per row,
-- optional per-package fulfillment fee.
--
-- Bulk mode (postage_mode='bulk'):
--   - input is a ShipStation postage-account ledger CSV
--     (TransactionTime, Amount, Balance) — only the Amount column matters.
--   - line items are postage PURCHASES, shape: { transaction_date, amount, billed }
--     where billed = amount (no markup).
--   - totals shape: { purchases, total, billed, shipments:0, items:0,
--     paid:0, cost_raw:0, cost:total, insurance:0, margin:0, fulfillment:0 }
--     — billed = total so every downstream "billed + fulfillment" reader
--     (QB invoice, PDF, portal, list) rolls up the reimbursement correctly.
--   - no markup %, no per-package fee, no shipping income / client profit.
--
-- Applies to BOTH postage-only and Full Service (combined) reports:
--   - postage-only bulk → ledger on line_items / totals
--   - combined bulk     → ledger on postage_line_items / postage_totals
--     (sales half on line_items / totals, unchanged)

ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS postage_mode text NOT NULL DEFAULT 'per_shipment';

ALTER TABLE shipstation_reports
  DROP CONSTRAINT IF EXISTS shipstation_reports_postage_mode_check;

ALTER TABLE shipstation_reports
  ADD CONSTRAINT shipstation_reports_postage_mode_check
  CHECK (postage_mode IN ('per_shipment', 'bulk'));
