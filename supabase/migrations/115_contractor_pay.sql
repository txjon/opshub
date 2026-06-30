-- Contractor pay: hourly rates + QB vendor mapping, gated to billing/owner
-- (can_manage_ap) so /hours (Dante) stays rate-blind. Plus a pay-run audit table
-- that records each pushed QB bill (with the rate used) and a double-push guard.

create table if not exists contractor_pay (
  contractor_id uuid primary key references contractors(id) on delete cascade,
  hourly_rate numeric not null default 0,
  qb_vendor_id text,
  qb_vendor_name text,
  updated_at timestamptz not null default now()
);
alter table contractor_pay enable row level security;
drop policy if exists "ap manage contractor_pay" on contractor_pay;
create policy "ap manage contractor_pay" on contractor_pay
  for all to authenticated using (can_manage_ap()) with check (can_manage_ap());
grant all on table contractor_pay to authenticated, service_role;

create table if not exists contractor_pay_runs (
  id uuid primary key default gen_random_uuid(),
  contractor_id uuid not null references contractors(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  hours numeric not null,
  rate numeric not null,
  amount numeric not null,
  qb_bill_id text,
  qb_doc_number text,
  pushed_by uuid,
  pushed_at timestamptz not null default now()
);
alter table contractor_pay_runs enable row level security;
drop policy if exists "ap manage contractor_pay_runs" on contractor_pay_runs;
create policy "ap manage contractor_pay_runs" on contractor_pay_runs
  for all to authenticated using (can_manage_ap()) with check (can_manage_ap());
grant all on table contractor_pay_runs to authenticated, service_role;

-- Stamp which punches were billed → blocks double-push, flags post-push edits.
alter table contractor_time_entries add column if not exists pay_run_id uuid references contractor_pay_runs(id) on delete set null;
create index if not exists idx_cte_pay_run on contractor_time_entries(pay_run_id);
