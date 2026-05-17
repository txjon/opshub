-- Per-item manual completion override. Set when Jon clicks "Mark
-- Complete" on an In Stock item in the Worksheet — moves a single
-- item to Complete without flipping the whole job to phase=complete
-- (jobs can have items released in waves, especially on stage route
-- where retail releases are timed per product, not per project).
--
-- Wins over per-item production state in the canonical resolver — an
-- item with completed_at set displays as Complete regardless of
-- pipeline_stage. Clearing the column ("Move back to In Stock") falls
-- back to whatever the underlying data says.
--
-- Future: once fulfillment products are dialed in, this manual action
-- will be replaced by an explicit "release for fulfillment" flow.

alter table items
  add column if not exists completed_at timestamptz;

create index if not exists items_completed_at_idx on items (completed_at);
