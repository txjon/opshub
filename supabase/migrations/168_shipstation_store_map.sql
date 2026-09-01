-- 168: shipstation_store_map — ShipStation store name → OpsHub client, for
-- the bulk fulfillment-invoice import (Sep 1 2026). The all-stores Shipping
-- Cost export identifies shipments only by store name, and store ≠ client
-- ("SupDef Shopify" + "Supdef" are both Superior Defense; "HPD SHOPIFY" is
-- internal). Learned once during a bulk run (assign or mark skip), reused
-- every month. skip=true = never billable (internal stores, Manual Orders).
create table if not exists shipstation_store_map (
  store_name text primary key,
  client_id uuid references clients(id) on delete set null,
  skip boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- RLS: internal tool — any authenticated team member can read + write
-- (mirrors shipstation_reports, mig 034).
alter table shipstation_store_map enable row level security;
drop policy if exists shipstation_store_map_all on shipstation_store_map;
create policy shipstation_store_map_all on shipstation_store_map
  for all to authenticated using (true) with check (true);

-- Explicit Data API grants (Supabase default change, enforced Oct 30 2026).
grant all on shipstation_store_map to service_role;
grant select, insert, update, delete on shipstation_store_map to authenticated;

notify pgrst, 'reload schema';
