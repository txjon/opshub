-- 214: NEW / UPDATED badges last until the client has looked (Jon, Nov 25
-- 2026). client_seen_version = the published version the client last reacted
-- to this item on (thumb, comment) or opened it full screen. A badge shows
-- while the item's added_in / updated_in is newer than that, however many
-- versions are published in between. HPD's own views never set it.
alter table line_sheet_items add column if not exists client_seen_version integer;
update line_sheet_items
   set client_seen_version = nullif(greatest(coalesce(client_thumb_version, 0), coalesce(client_note_version, 0)), 0)
 where client_seen_version is null;
notify pgrst, 'reload schema';
