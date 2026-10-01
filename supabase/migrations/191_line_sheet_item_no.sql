-- Permanent per-sheet item numbers: assigned once (shelf landing or publish),
-- never reshuffled, never reused. The client-facing default name is this number.
alter table line_sheet_items add column if not exists item_no int;
create unique index if not exists line_sheet_items_no_uq
  on line_sheet_items (sheet_id, item_no) where item_no is not null;
