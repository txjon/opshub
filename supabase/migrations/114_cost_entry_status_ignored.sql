-- Soft-ignore for freight charges: truly excluded from variance, but kept in the
-- DB so re-uploaded CSVs still dedupe against them. (Distinct from not_job_specific,
-- which counts toward the total as a general/pooled cost.)
alter table cost_entries drop constraint if exists cost_entries_status_check;
alter table cost_entries add constraint cost_entries_status_check
  check (status in ('unmatched','matched','billed','paid','ignored'));
