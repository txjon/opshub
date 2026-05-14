-- items.pipeline_stage was added in migration 004 with a default of
-- 'blanks_ordered'. That meant every new item entered the system with
-- pipeline_stage = 'blanks_ordered' even when no blanks had actually
-- been ordered — bleeding into the client portal as "Preparing", into
-- the BlanksTab progression check, and into lifecycle calculations.
--
-- pipeline_stage should be null until production work actually starts.
-- Drop the default and clear the bogus historical values: any item
-- currently marked 'blanks_ordered' but with no blanks order recorded
-- (blanks_order_cost is null or zero) is a false positive from the
-- default — null those out.
--
-- Items where a real blanks order was logged (blanks_order_cost > 0)
-- keep pipeline_stage = 'blanks_ordered' — those are legitimate.

alter table items alter column pipeline_stage drop default;

update items
set pipeline_stage = null
where pipeline_stage = 'blanks_ordered'
  and (blanks_order_cost is null or blanks_order_cost = 0);
