-- Per-package fulfillment fee for postage reports.
--
-- Lives alongside the existing percentage markup on postage. The two
-- are conceptually separate:
--   hpd_fee_pct (markup) — applied to the carrier cost; pass-through
--     billing where client pays HPD what HPD paid the carrier plus a
--     % handling fee. Their store's postage performance.
--   hpd_per_package_fee — flat HPD fulfillment service charge per
--     shipment shipped (pick / pack / handoff). Separate expense for
--     the client; doesn't affect their store's postage margin.
--
-- Both can apply at the same time on a single postage report.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS hpd_per_package_fee numeric(10, 2) DEFAULT 0;

ALTER TABLE shipstation_reports
  ADD COLUMN IF NOT EXISTS per_package_fee numeric(10, 2) DEFAULT 0;
