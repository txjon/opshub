-- 117 — The production→warehouse handoff spine (V2 Phase 2, slice 1).
--
-- Promotes the warehouse's core nouns to real tables:
--   shipments        — a physical box/pallet from a vendor, previously a
--                      DERIVED grouping (lib/use-shipments groupKeyFor). Carries
--                      the handoff packet: expected arrival, warehouse_notes
--                      (production's instructions to distro), packing slip.
--   shipment_lines   — what's in the box, per item, per-size shipped/received.
--   pull_requests    — "pull N units for X" — created by production ahead of
--                      arrival OR ad-hoc at receive; fulfilled by warehouse.
--   pulled_inventory — where pulled units live after the pull (held/returned/
--                      shipped_out/consumed). Small ledger, pulls only —
--                      bulk webstore stock stays in Shopify by decision.
--
-- shipments.group_key mirrors lib/use-shipments groupKeyFor EXACTLY so the
-- legacy derived grouping and the new rows can never disagree during the
-- dual-write transition. Legacy item columns (ship_qtys/received_qtys/
-- sample_qtys) keep being written — readers migrate page by page.

-- ── shipments ──────────────────────────────────────────────────────────
create table if not exists shipments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  direction text not null default 'inbound' check (direction in ('inbound','outbound')),
  source text not null default 'decorator' check (source in ('decorator','outside','client_supply')),
  decorator_id uuid references decorators(id) on delete set null,
  group_key text not null,
  carrier text,
  tracking text,                       -- normalized (trim+upper); null = pickup / no tracking
  pickup boolean not null default false,
  expected_arrival date,
  status text not null default 'expected' check (status in ('expected','received','closed')),
  warehouse_notes text,                -- THE handoff field: production → distro instructions
  packing_slip_file_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  received_at timestamptz,
  received_by uuid
);
create unique index if not exists idx_shipments_company_group on shipments(company_id, group_key);
create index if not exists idx_shipments_status on shipments(status);
create index if not exists idx_shipments_decorator on shipments(decorator_id);

-- ── shipment_lines ─────────────────────────────────────────────────────
create table if not exists shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  description text,                    -- survives item deletion
  ship_qtys jsonb,                     -- per-size shipped from vendor
  received_qtys jsonb,                 -- per-size received at HPD
  condition text,
  notes text,
  received boolean not null default false,
  received_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists idx_shipment_lines_ship_item on shipment_lines(shipment_id, item_id);
create index if not exists idx_shipment_lines_job on shipment_lines(job_id);

-- ── pull_requests ──────────────────────────────────────────────────────
create table if not exists pull_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  job_id uuid references jobs(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  shipment_id uuid references shipments(id) on delete set null,
  kind text not null default 'sample' check (kind in ('sample','photo','catalog','client','event','other')),
  qtys jsonb not null default '{}',    -- requested, per-size
  fulfilled_qtys jsonb,
  reason text,
  status text not null default 'pending' check (status in ('pending','partial','fulfilled','cancelled')),
  requested_by uuid,
  requested_by_name text,
  created_at timestamptz not null default now(),
  fulfilled_at timestamptz,
  fulfilled_by uuid
);
create index if not exists idx_pull_requests_item on pull_requests(item_id);
create index if not exists idx_pull_requests_job on pull_requests(job_id);
create index if not exists idx_pull_requests_status on pull_requests(status);

-- ── pulled_inventory ───────────────────────────────────────────────────
create table if not exists pulled_inventory (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  pull_request_id uuid references pull_requests(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  item_id uuid references items(id) on delete set null,
  item_name text,                      -- survives item deletion
  qtys jsonb not null default '{}',    -- units currently in this bucket, per size
  location text,
  status text not null default 'held' check (status in ('held','returned','shipped_out','consumed')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index if not exists idx_pulled_inventory_item on pulled_inventory(item_id);
create index if not exists idx_pulled_inventory_status on pulled_inventory(status);

-- ── RLS: permissive team policy + restrictive company scope (house pattern,
--        mirrors migrations 059/060) ─────────────────────────────────────
do $$
declare
  tbl text;
  new_tables text[] := array['shipments', 'shipment_lines', 'pull_requests', 'pulled_inventory'];
begin
  foreach tbl in array new_tables loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format(
      'create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
  end loop;
  -- company scope on the tables that carry company_id (shipment_lines scopes
  -- through its parent shipment; a restrictive policy there would need a
  -- subquery per row — cascade delete + parent scope covers it).
  foreach tbl in array array['shipments', 'pull_requests', 'pulled_inventory'] loop
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format(
      'create trigger fill_company_id before insert on %I
       for each row execute function default_company_id_to_hpd()', tbl);
    execute format('drop policy if exists company_scope_restrictive on %I', tbl);
    execute format(
      'create policy company_scope_restrictive on %I as restrictive
       for all to authenticated
       using (company_id = any(public.current_user_company_ids()))
       with check (company_id = any(public.current_user_company_ids()))',
      tbl
    );
  end loop;
end $$;

-- ── Backfill: existing items.sample_pulls JSONB → pull_requests rows ────
-- One row per pull entry. `pulled` → fulfilled (qtys copied to fulfilled_qtys
-- so balance math is reconstructable); un-pulled → pending. The legacy `for` /
-- `to` strings become the reason. items.sample_pulls is left in place untouched
-- (read-only fallback until the code cutover ships; nothing writes it after).
-- Skips rows with no qtys map (the pre-migration single-size dev shape carries
-- {size,qty} — those early test entries are not worth converting).
insert into pull_requests (company_id, job_id, item_id, kind, qtys, fulfilled_qtys, reason, status, requested_by_name, created_at, fulfilled_at)
select
  i.company_id,
  i.job_id,
  i.id,
  'sample',
  coalesce(p.entry->'qtys', '{}'::jsonb),
  case when coalesce((p.entry->>'pulled')::boolean, false) then coalesce(p.entry->'qtys', '{}'::jsonb) else null end,
  nullif(trim(concat_ws(' → ', nullif(trim(coalesce(p.entry->>'for', '')), ''), nullif(trim(coalesce(p.entry->>'to', '')), ''))), ''),
  case when coalesce((p.entry->>'pulled')::boolean, false) then 'fulfilled' else 'pending' end,
  'Backfill (production sample pull)',
  now(),
  case when coalesce((p.entry->>'pulled')::boolean, false) then now() else null end
from items i
cross join lateral jsonb_array_elements(i.sample_pulls) as p(entry)
where jsonb_typeof(i.sample_pulls) = 'array'
  and jsonb_typeof(p.entry->'qtys') = 'object'
  and p.entry->'qtys' <> '{}'::jsonb;

-- Fulfilled backfilled pulls become pulled_inventory buckets (status 'held' —
-- the warehouse reviews and resolves them; we can't know from JSONB whether
-- units were consumed or shipped out already).
insert into pulled_inventory (company_id, pull_request_id, job_id, item_id, item_name, qtys, status, notes)
select pr.company_id, pr.id, pr.job_id, pr.item_id, i.name, pr.fulfilled_qtys, 'held',
       coalesce(pr.reason, 'Backfilled pull — review & resolve')
from pull_requests pr
join items i on i.id = pr.item_id
where pr.status = 'fulfilled' and pr.requested_by_name = 'Backfill (production sample pull)'
  and pr.fulfilled_qtys is not null and pr.fulfilled_qtys <> '{}'::jsonb;
