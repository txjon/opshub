-- THE PLANNER (Jon, Nov 27 2026): a client's planner is not one release's
-- proposal any more (mig 192/193); releases are many and separate, joined to
-- cards through release_slots (mig 217). Step 1: the link stops being
-- required, so new planners are born without one. Step 2 (mig 221) unlinks every row; step 3 (mig 222, after the
-- code that reads it is gone from prod) drops the column.
alter table line_sheets alter column release_id drop not null;
