-- 181: Split shipments — cleanup (Sep 15 2026). The client address book
-- (client_locations, mig 180) is the only home for a ship-to now. Every reader
-- goes through lib/destinations; the transition mirror is deleted. So:
--   jobs.type_meta.venue_address  → superseded by jobs.ship_to_location_id
--   jobs.type_meta.po_ship_to     → the pre-180 per-vendor PO override (17
--                                   complete jobs; vendor paper resolves ship-to)
--   clients.shipping_address      → superseded by the client's default location
update jobs set type_meta = (coalesce(type_meta, '{}'::jsonb) - 'venue_address') - 'po_ship_to'
  where type_meta ? 'venue_address' or type_meta ? 'po_ship_to';
alter table clients drop column if exists shipping_address;
notify pgrst, 'reload schema';
