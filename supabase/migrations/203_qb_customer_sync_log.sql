-- 203: audit log for the OpsHub → QuickBooks customer profile sync
-- (lib/qb-customer-sync). One row per write: which fields, QB before, what was sent.
create table if not exists public.qb_customer_sync_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete cascade,
  qb_customer_id text not null,
  fields text[] not null,
  before jsonb not null,
  after jsonb not null,
  source text not null default 'manual',   -- manual (preview) | info_form | client_edit
  synced_by uuid,
  synced_at timestamptz not null default now()
);
create index if not exists qb_customer_sync_log_client on public.qb_customer_sync_log (client_id, synced_at desc);
alter table public.qb_customer_sync_log enable row level security;
drop policy if exists "team read" on public.qb_customer_sync_log;
create policy "team read" on public.qb_customer_sync_log for select to authenticated using (true);
grant select on table public.qb_customer_sync_log to authenticated;
grant all on table public.qb_customer_sync_log to service_role;
drop trigger if exists fill_company_id on public.qb_customer_sync_log;
create trigger fill_company_id before insert on public.qb_customer_sync_log for each row execute function default_company_id_to_hpd();
notify pgrst, 'reload schema';
