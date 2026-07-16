-- 123: per-vendor transit defaults (date-flow chain, locked 2026-07-15)
--
-- transit_defaults = days from "vendor ships" to "at HPD dock", per ship
-- method: {"ground": 3, "freight": 3, "ocean": 35}. A missing key = the
-- vendor never ships that way. Used with lead_time_days (PO -> ships) to
-- derive the chain: suggested ship-by = PO date + lead; arrival = ship-by
-- + transit(method); client ETA = arrival + route buffer.
--
-- Supersedes the never-populated decorators.transit_days (left in place,
-- all NULL; drop in a later cleanup).

alter table decorators add column if not exists transit_defaults jsonb;

comment on column decorators.transit_defaults is
  'Ship->HPD transit days per method {ground,freight,ocean}; missing key = method unused. Pairs with lead_time_days for date-chain derivation.';
