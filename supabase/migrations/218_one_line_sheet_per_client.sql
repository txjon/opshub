-- ONE BOARD PER CLIENT (Jon, Nov 26 2026): a client has at most one live
-- (unarchived) line sheet. It's his Line sheet tab; releases are fed from it
-- (mig 217). Archive the old one to start another. Checked before applying:
-- every client has at most one unarchived sheet.
create unique index if not exists line_sheets_one_live_per_client
  on line_sheets(client_id) where archived_at is null;

notify pgrst, 'reload schema';
