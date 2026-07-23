-- Per-item exit-factory / ship date override (the production tab's "Adjust date").
--
-- Date model (confirmed with Jon 2026-07-23): once an item is in production, the
-- date Drake edits is the SHIP date (exit factory), NOT the arrival. The chain
-- then derives arrival = ship_est + transit, client ETA = arrival + HPD
-- processing buffer. Receiving still owns the actual LAND date
-- (shipments.expected_arrival). This replaces the old behavior where the
-- production edit wrote items.expected_arrival (an arrival override that wrongly
-- skipped the transit leg — a 35-day error for ocean vendors).
--
-- items.expected_arrival is kept as a LEGACY arrival override for items edited
-- before this change (no new writer); setting ship_est clears it on that item.
ALTER TABLE items ADD COLUMN IF NOT EXISTS ship_est date;

COMMENT ON COLUMN items.ship_est IS
  'Per-item exit-factory/ship date override, set on the production tab. Feeds the chain ship leg (arrival = ship_est + transit). Supersedes items.expected_arrival, which is now legacy.';
