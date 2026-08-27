-- 167: SOFT DELETE for designs (Jon, Aug 26 2026 — two hard-deleted designs in
-- one night, one unrecoverable). Deleting a design in the studio now stamps
-- deleted_at; files, messages and designer orders stay put; a "Deleted" fold
-- restores it. Hard delete is no longer reachable from the UI.
alter table art_briefs add column if not exists deleted_at timestamptz;
create index if not exists art_briefs_deleted_idx on art_briefs(deleted_at) where deleted_at is not null;
