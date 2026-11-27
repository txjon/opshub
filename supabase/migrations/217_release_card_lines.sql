-- THE BOARD → THE RELEASE (Jon, Nov 26 2026). Two rooms, one door: a card
-- on the client's board (line_sheet_items) goes into a release as a line.
-- A card can be in MORE THAN ONE release (Jon: yes), so no committed-lane
-- guard across releases; once per release.
--   line_id "card:{itemId}" (the lane, lib/release-lanes isCardLineId)
--   line_sheet_item_id — the card (FK, so the line always finds its art)
--   added_by — 'client' | 'hpd' ("Added by HPD" on the client's side)
-- The client adds As is cards; HPD adds As is or Change (a Change line reads
-- "art in progress" and can't be cut or bought until it's As is).
alter table release_slots
  add column if not exists line_sheet_item_id uuid references line_sheet_items(id) on delete set null,
  add column if not exists added_by text check (added_by in ('client', 'hpd'));
create unique index if not exists release_slots_card_uniq
  on release_slots(release_id, line_sheet_item_id) where line_sheet_item_id is not null;

-- Schema only. No backfill: Jon picks which cards go in (Add to release).
notify pgrst, 'reload schema';
