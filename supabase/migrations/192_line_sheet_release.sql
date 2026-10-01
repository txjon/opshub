-- 192: THE LINE SHEET becomes a stage of a RELEASE (Jon, Oct 1 2026).
-- A line sheet is the proposal step of one release: the client thumbs the
-- line, ops builds the release's lines from the survivors BY HAND (no
-- conversion code, by decision). One sheet per release.
-- ADDITIVE ONLY: prod still runs the standalone-tab code against this same
-- DB, so NOT NULL + retiring the 'linesheets' grant wait for mig 193 (apply
-- at the push that ships the release-scoped hub page).
alter table line_sheets add column if not exists release_id uuid references releases(id) on delete restrict;
create unique index if not exists line_sheets_release_uniq on line_sheets(release_id) where release_id is not null;

-- Backfill: every existing sheet gets its own building release, titled after
-- the sheet (Sike Ops 'Fall 2026' is the only one, Oct 1 2026).
do $$
declare s record; rid uuid;
begin
  for s in select ls.id, ls.title, ls.client_id, c.company_id
           from line_sheets ls join clients c on c.id = ls.client_id
           where ls.release_id is null loop
    insert into releases (company_id, client_id, title, model, status, status_timestamps)
    values (s.company_id, s.client_id, s.title, null, 'building', jsonb_build_object('building', now()))
    returning id into rid;
    update line_sheets set release_id = rid where id = s.id;
  end loop;
end $$;

notify pgrst, 'reload schema';
