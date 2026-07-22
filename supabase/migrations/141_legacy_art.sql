-- 141: LEGACY ART INDEX (Jul 22 2026). Read-only pointers into pre-OpsHub
-- Drive archives, indexed per client one folder at a time (Superior Defense
-- first). Files stay exactly where they live — Drive file IDs are stable
-- across moves, so the archive can be reorganized freely without breaking
-- this. Never touched by the ref-counted OpsHub file machinery; promotion
-- onto a brief/product copies a POINTER, with dedupe at the point of use.
create table if not exists legacy_art_files (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid references clients(id) on delete cascade,
  root_folder_id text not null,        -- the indexed archive root
  drive_file_id text not null unique,
  file_name text,
  mime_type text,
  folder_path text,                    -- e.g. "Apparel/DOBY V2"
  size_bytes bigint,
  modified_at timestamptz,
  indexed_at timestamptz not null default now()
);
create index if not exists idx_legacy_art_client on legacy_art_files(client_id);
create index if not exists idx_legacy_art_path on legacy_art_files(folder_path);

do $$
begin
  execute 'alter table legacy_art_files enable row level security';
  execute 'drop policy if exists "team all" on legacy_art_files';
  execute 'create policy "team all" on legacy_art_files for all to authenticated using (true) with check (true)';
  execute 'grant all on table legacy_art_files to authenticated, service_role';
  execute 'drop trigger if exists fill_company_id on legacy_art_files';
  execute 'create trigger fill_company_id before insert on legacy_art_files
           for each row execute function default_company_id_to_hpd()';
  execute 'drop policy if exists company_scope_restrictive on legacy_art_files';
  execute 'create policy company_scope_restrictive on legacy_art_files as restrictive
           for all to authenticated
           using (company_id = any(public.current_user_company_ids()))
           with check (company_id = any(public.current_user_company_ids()))';
end $$;
