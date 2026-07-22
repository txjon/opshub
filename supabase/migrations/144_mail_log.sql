-- 144: internal mail log (Jul 22). Append-only record of every directive
-- email sendInternalMail fires (labs/distro/ecomm). Deliberately its OWN
-- table: nothing in phase/date/wire logic reads it — pure audit, zero
-- interaction with any calculation (Jon's condition).
create table if not exists mail_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  kind text not null,
  to_addrs text[] not null default '{}',
  subject text,
  job_id uuid,          -- soft reference only, no FK — a deleted job keeps its trail
  meta jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists idx_mail_log_created on mail_log(created_at desc);

do $$
begin
  execute 'alter table mail_log enable row level security';
  execute 'drop policy if exists "team all" on mail_log';
  execute 'create policy "team all" on mail_log for all to authenticated using (true) with check (true)';
  execute 'grant all on table mail_log to authenticated, service_role';
  execute 'drop trigger if exists fill_company_id on mail_log';
  execute 'create trigger fill_company_id before insert on mail_log
           for each row execute function default_company_id_to_hpd()';
  execute 'drop policy if exists company_scope_restrictive on mail_log';
  execute 'create policy company_scope_restrictive on mail_log as restrictive
           for all to authenticated
           using (company_id = any(public.current_user_company_ids()))
           with check (company_id = any(public.current_user_company_ids()))';
end $$;
