-- Free-form row layout for the staging Brand Planner.
-- Each release_items row gets a row_index so tiles in a release form
-- explicit horizontal rows the client lays out manually (e.g. tees on
-- row 0, shorts on row 1, with different counts per row). Within a row,
-- the existing sort_order is the left-to-right position. Empty rows
-- collapse client-side so the data is sparse-friendly.
--
-- Default row_index = 0 so existing release_items keep behavior
-- (everything in one big row, which still flows correctly because the
-- client renders by (row_index, sort_order)).

ALTER TABLE release_items
  ADD COLUMN IF NOT EXISTS row_index integer NOT NULL DEFAULT 0;

-- Composite index for the (release, row, sort) lookup that drives the
-- staging UI render order.
CREATE INDEX IF NOT EXISTS release_items_release_row_idx
  ON release_items(release_id, row_index, sort_order);
