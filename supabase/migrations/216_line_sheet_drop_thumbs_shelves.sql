-- Apply AFTER the verdicts deploy is live (mig 215). Retires the thumb and
-- the shelves for good.
-- 1. Any thumb the old code wrote after mig 215 ran becomes a verdict first
--    (a thumb CLEARED in that window can't be told from an untouched one, and
--    stays as its mig 215 verdict).
update line_sheet_items set
  client_verdict = case client_thumb when 'up' then 'liked' when 'down' then 'pass' end,
  client_verdict_at = client_thumb_at,
  client_verdict_version = client_thumb_version,
  client_verdict_by = 'client'
--    Only thumbs made after mig 215 ran (Nov 26 2026 afternoon; the cutoff is 1pm PT, before it ran;
--    anything earlier was copied by 215), and only when newer than the verdict.
--    client_verdict_at is the verdict's last change, kept on a clear too, so
--    a verdict set or cleared by the new code is never overwritten. (A merge
--    copies the donor's older stamp; the cutoff covers that.)
where client_thumb is not null
  and client_thumb_at > '2026-11-26 21:00:00+00'::timestamptz
  and client_thumb_at > coalesce(client_verdict_at, '-infinity'::timestamptz);
-- 2. Drop the retired columns and the shelves.
alter table line_sheet_items
  drop column if exists client_thumb,
  drop column if exists client_thumb_at,
  drop column if exists client_thumb_version,
  drop column if exists client_thumb_note,
  drop column if exists section_id;
drop table if exists line_sheet_sections;
alter table line_sheets drop column if exists season;

notify pgrst, 'reload schema';
