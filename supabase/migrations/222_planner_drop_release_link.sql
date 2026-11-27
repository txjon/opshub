-- Step 3 of mig 220 (221 unlinked the rows): nothing reads line_sheets.release_id any more. Its
-- unique index (mig 192) goes with it.
drop index if exists line_sheets_release_uniq;
alter table line_sheets drop column if exists release_id;
