-- Contractor hours logging. Replaces the weekly sticky-note of per-person
-- totals with per-day punches (time in / out / break minutes); hours are
-- COMPUTED in the app from these, never stored, so edits stay correct.

create table if not exists contractors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists contractor_time_entries (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  work_date date not null,
  time_in time,
  time_out time,
  break_minutes int not null default 0,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_cte_contractor_date
  on contractor_time_entries(contractor_id, work_date);
create index if not exists idx_cte_work_date
  on contractor_time_entries(work_date desc);

-- RLS — authenticated team manages both. (Internal tool; no tenant gating.)
alter table contractors enable row level security;
alter table contractor_time_entries enable row level security;
drop policy if exists "Authenticated manage contractors" on contractors;
create policy "Authenticated manage contractors" on contractors
  for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated manage contractor_time_entries" on contractor_time_entries;
create policy "Authenticated manage contractor_time_entries" on contractor_time_entries
  for all to authenticated using (true) with check (true);

-- Data API GRANTs — new public tables need explicit grants (Supabase default
-- change). Without these the PostgREST/client reads return permission errors.
grant all on table contractors to authenticated, service_role;
grant all on table contractor_time_entries to authenticated, service_role;
