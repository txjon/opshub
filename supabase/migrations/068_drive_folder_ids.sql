-- Stash Drive folder IDs on clients / jobs / items so uploads don't have
-- to re-resolve the path each time. Fixes a bug where renaming a project
-- memo (or client name, or item name) after files were already uploaded
-- caused the next upload to create a new sibling folder under the
-- updated path, splitting the project's files across two locations.
--
-- New flow:
--   - First upload for a client/job/item walks Client → Project → Item
--     find-or-create, then stashes each folder's id on the matching row.
--   - All subsequent uploads use the stashed id directly. Path is no
--     longer authoritative.
--   - When the underlying name field changes (clients.name, jobs.title,
--     items.name), an /api/drive/rename hook renames the Drive folder
--     in place. The stashed id never changes, so anything pointing at
--     that folder (PO file links, item drive_link) stays valid.
--
-- Columns are nullable — existing rows with files in legacy path-based
-- folders will lazily migrate on next upload, or stay where they are
-- until renamed.

alter table clients
  add column if not exists drive_folder_id text;

alter table jobs
  add column if not exists drive_folder_id text;

alter table items
  add column if not exists drive_folder_id text;

comment on column clients.drive_folder_id is 'Google Drive folder ID for this client. Set lazily on first upload; renames in place when clients.name changes.';
comment on column jobs.drive_folder_id is 'Google Drive folder ID for this project (memo). Set lazily on first upload; renames in place when jobs.title changes.';
comment on column items.drive_folder_id is 'Google Drive folder ID for this item. Set lazily on first upload; renames in place when items.name changes.';
