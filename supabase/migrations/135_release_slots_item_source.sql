-- 135 — Release slots can source from PRODUCTION ITEMS, not just studio
-- ideas (Jon-as-FOG, Jul 21: "I want to see the items that are in the
-- pipeline, select them, and have a target date generated from the
-- selected items' last landing date").
--
-- A slot now points at EITHER (brief_id, line_id) — a pre-item — OR
-- item_id — an existing in-production item joining the release. Item-
-- sourced slots snapshot format = item name, retail = client retail,
-- qtys prefilled from the item's buy sheet (the run already exists).
-- The cut never re-creates item-sourced slots' items.

alter table release_slots alter column brief_id drop not null;

-- one release row per item (brief uniqueness already covered)
create unique index if not exists uq_release_slots_item
  on release_slots(release_id, item_id) where item_id is not null;
