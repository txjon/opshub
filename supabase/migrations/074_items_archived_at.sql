-- Per-item Archive flag — separates active work from finished work
-- on every default view. Auto-set when an item has been Complete for
-- 30+ days (computed at read time as a fallback; cron / write-hook
-- can populate it eagerly in a future migration). Manual archive
-- also writes here.
--
-- Why: clients were seeing old delivered items mixed with active
-- ones in their portal. "I thought the belts were delivered? unless
-- that's the last shipment." Active views now filter where
-- archived_at IS NULL.
--
-- The underlying production state stays as-is on the item
-- (sell_per_unit, pipeline_stage, etc.) — Archive is orthogonal,
-- purely a view-bucket flag.

alter table items
  add column if not exists archived_at timestamptz;

create index if not exists items_archived_at_idx on items (archived_at);
