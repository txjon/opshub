-- Line sheets can be archived (Nov 2026): off the Studio list and out of the
-- client hub, data kept (items, versions, client thumbs). Null = active.
alter table line_sheets add column if not exists archived_at timestamptz;
