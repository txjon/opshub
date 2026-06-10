-- Per-item sample pulls — an ad-hoc list of internal "pull a sample" jobs
-- attached to an item, set on the Production page when the item ships and
-- surfaced to the warehouse on Receiving. There is no fixed set of pulls,
-- so this is a free-form list the operator grows per item.
--
-- Each entry: { qty, size, for, to, pulled }
--   qty    — how many to pull
--   size   — which size (structured, from the item's sizes) so Receiving can
--            auto-count it into sample_qtys
--   for    — who the sample is for
--   to     — where it needs to go (ship address, photoshoot, client comp, etc.)
--   pulled — set true on Receiving when the warehouse checks it off; the qty is
--            then rolled into items.sample_qtys[size] (which deducts from the
--            continuing client qty)
--
-- Internal only. Works WITH items.sample_qtys (per-size pulled counts) rather
-- than duplicating it. Distinct from items.client_eta_note (client-facing).
-- Receiving reads this alongside items.client_eta (the delivery ETA).

alter table items
  add column if not exists sample_pulls jsonb not null default '[]'::jsonb;
