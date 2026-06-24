-- 098: Post-job cost reconciliation (AP side). Phase 1 — schema only.
-- Assistant enters vendor invoices + freight; each line (a PO-line total) is
-- matched to a job by PO ref (po_ref's 4-digit = jobs.type_meta.qb_invoice_number,
-- or a full HPD-YYMM-NNN job number) and compared to the expected decorator cost
-- from costing → variance → per-job true margin. Decorator lines later group into
-- a QB Bill (Phase 3). See memory: opshub-cost-reconciliation.

-- Payable vendors — decorators AND carriers (UPS/FedEx) etc. qb_vendor_id /
-- default_expense_account stay null until Phase 3 wires the QB Bill write-path.
create table if not exists ap_vendors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null default 'decorator' check (kind in ('decorator','carrier','other')),
  decorator_id uuid references decorators(id) on delete set null,
  qb_vendor_id text,
  default_expense_account text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_ap_vendors_decorator on ap_vendors(decorator_id);

-- One reconciliation line = one PO-line total (NOT per-garment). source tags the
-- feeder; charge_type splits cost-of-goods from setup/sample/freight/other so the
-- per-job rollup can separate fluctuating fees. expected_amount is a snapshot of
-- the costing baseline at entry time (costing can change after). job_id is null
-- while a ref is unmatched (manual job-pick queue).
create table if not exists cost_entries (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'decorator_invoice'
    check (source in ('decorator_invoice','freight','blanks')),
  vendor_id uuid references ap_vendors(id) on delete set null,
  vendor_name text,                 -- denormalized fallback (e.g. carrier with no ap_vendors row yet)
  vendor_invoice_number text,
  po_ref text,                      -- raw as entered, e.g. "4308-A"
  job_id uuid references jobs(id) on delete set null,
  amount numeric not null default 0,
  expected_amount numeric,          -- snapshot of expected decorator cost for variance (nullable)
  charge_type text not null default 'production'
    check (charge_type in ('production','setup_mold','sample','freight','other')),
  status text not null default 'unmatched'
    check (status in ('unmatched','matched','billed','paid')),
  bill_id uuid,                     -- FK added in Phase 3 (vendor_bills)
  not_job_specific boolean not null default false,  -- freight/account fees that don't roll to a job
  notes text,
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists idx_cost_entries_job on cost_entries(job_id);
create index if not exists idx_cost_entries_vendor on cost_entries(vendor_id);
create index if not exists idx_cost_entries_status on cost_entries(status);

-- RLS — authenticated team manages both. (Internal tool; no tenant gating, same
-- as contractor hours.)
alter table ap_vendors enable row level security;
alter table cost_entries enable row level security;
drop policy if exists "Authenticated manage ap_vendors" on ap_vendors;
create policy "Authenticated manage ap_vendors" on ap_vendors
  for all to authenticated using (true) with check (true);
drop policy if exists "Authenticated manage cost_entries" on cost_entries;
create policy "Authenticated manage cost_entries" on cost_entries
  for all to authenticated using (true) with check (true);

-- Data API GRANTs — new public tables need explicit grants (Supabase default
-- change). Without these, PostgREST/client reads return permission errors.
grant all on table ap_vendors to authenticated, service_role;
grant all on table cost_entries to authenticated, service_role;

-- Seed payable vendors from existing decorators (idempotent) + a UPS carrier row.
-- ap_vendors.name is for display; expected-cost matching joins through decorator_id.
insert into ap_vendors (name, kind, decorator_id)
select d.name, 'decorator', d.id from decorators d
where not exists (select 1 from ap_vendors av where av.decorator_id = d.id);
insert into ap_vendors (name, kind)
select 'UPS', 'carrier'
where not exists (select 1 from ap_vendors where name = 'UPS' and kind = 'carrier');
