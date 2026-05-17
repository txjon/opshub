-- Per-item shipping route override. Job-level shipping_route is the
-- default for every item on the job (drop_ship / ship_through / stage),
-- but rare cases need a single item to take a different path —
-- e.g. one item ships from decorator A directly to decorator B for
-- a second decoration step instead of coming back to HPD.
--
-- When set, this column wins over jobs.shipping_route in every status
-- resolver and address-derivation surface. Null = use the job default.
--
-- Values are the same set as jobs.shipping_route so the canonical
-- resolver can treat them interchangeably without branching.

alter table items
  add column if not exists shipping_route text;

alter table items
  drop constraint if exists items_shipping_route_check;

alter table items
  add constraint items_shipping_route_check
  check (shipping_route is null or shipping_route in ('drop_ship', 'ship_through', 'stage'));
