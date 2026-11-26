-- 213: the client's comment on a line sheet item, independent of the thumb
-- (Jon, Nov 25 2026). One comment per item, any time (up, down or none);
-- client_note_version = the published version it was written on, so after
-- new art lands (updated_in > client_note_version) it reads "on the previous
-- version". Supersedes client_thumb_note (mig 195), which only rode a
-- thumbs-down; that column is dropped once this code is live (mig 214).
alter table line_sheet_items add column if not exists client_note text;
alter table line_sheet_items add column if not exists client_note_version integer;
update line_sheet_items
   set client_note = client_thumb_note,
       client_note_version = coalesce(client_thumb_version, updated_in, added_in)
 where client_thumb_note is not null and client_note is null;
notify pgrst, 'reload schema';
