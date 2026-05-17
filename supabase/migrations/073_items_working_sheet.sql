-- Per-client "Working Sheet" view on /clients/[id]. A back-office
-- workspace for Jon to track economics + status per item across all
-- the client's projects. Carries over the old /staging tool's value
-- (financial roll-up, manual stage buckets, retail-vs-cost margin)
-- without entangling with the operational production workflow.
--
-- working_status — manual bucket override. NULL = derive from job
-- phase. Allowed values: 'pending' | 'in_production' | 'landed'.
--
-- client_retail_per_unit — what the client charges their end
-- customer. Sits alongside items.sell_per_unit (what we charge the
-- client) so the working sheet can compute the *client's* profit.
-- Distinct from any of our pricing fields — pure back-office number.

alter table items
  add column if not exists working_status text,
  add column if not exists client_retail_per_unit numeric;

alter table items
  drop constraint if exists items_working_status_check;
alter table items
  add constraint items_working_status_check
  check (working_status is null or working_status in ('pending', 'in_production', 'landed'));
