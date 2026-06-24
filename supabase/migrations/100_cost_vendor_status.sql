-- 100: "mark cost-complete" for a job × vendor in the billing queue. The human
-- "this vendor is fully billed" signal — resolves the partial-vs-underbilled
-- ambiguity the tool can't infer, and drops the residual variance out of the
-- OPEN PO total (so the cash number is precise, not conservative). reason = the
-- disposition (matches / came-in-under / overbill / QB-addition / costing-miss),
-- so the board separates "$X to chase" from "$X that's fine". See memory:
-- opshub-cost-reconciliation.
create table if not exists cost_vendor_status (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  vendor_id uuid not null references ap_vendors(id) on delete cascade,
  status text not null default 'complete' check (status in ('complete')),
  reason text,            -- 'matches'|'under'|'over_accept'|'over_dispute'|'qb_addition'|'costing_miss'|'other'
  note text,
  marked_by text,
  marked_at timestamptz not null default now(),
  unique (job_id, vendor_id)
);
create index if not exists idx_cvs_job on cost_vendor_status(job_id);

alter table cost_vendor_status enable row level security;
drop policy if exists "Authenticated manage cost_vendor_status" on cost_vendor_status;
create policy "Authenticated manage cost_vendor_status" on cost_vendor_status
  for all to authenticated using (true) with check (true);
grant all on table cost_vendor_status to authenticated, service_role;
