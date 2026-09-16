-- 180: Split shipments — foundation (Sep 15 2026). One project can ship to
-- two or more client addresses (first case: Silencer Co, part to their
-- marketing office, part to their fulfillment center). Design map:
-- https://claude.ai/artifact/TaR32tPynQBHzpn7BFk2hv
--
-- Before this, a job had ONE free-text ship-to (jobs.type_meta.venue_address,
-- seeded from clients.shipping_address) and a box never recorded where it
-- went. This migration adds the objects; readers cut over in later phases and
-- the free-text fields are deleted at the end (never two sources of truth).
--
--   client_locations   — the client's address book (Main + named locations;
--                        job_id set = a one-off address for that project only)
--   jobs.ship_to_location_id — the project's default destination
--   item_destinations  — per-item per-size split across locations
--                        (no rows = 100% to the project default)
--   shipments.location_id + ship_to_snapshot — every client-bound box knows
--                        where it went; the address FREEZES at ship time
--   shipments.direction 'direct' — vendor→client box (drop_ship). Was written
--                        as 'inbound', which the hub leak-guard hides (H1).

-- ── client_locations ───────────────────────────────────────────────────
create table if not exists client_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid not null references clients(id) on delete cascade,
  job_id uuid references jobs(id) on delete cascade,   -- null = in the client's book; set = this project only
  label text not null,                                  -- "Main", "Marketing office", "Fulfillment center"
  address text not null,                                -- free text, mailing-label lines (same shape as today)
  contact_name text,
  contact_phone text,
  is_default boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_client_locations_client on client_locations(client_id);
create index if not exists idx_client_locations_job on client_locations(job_id);
-- one default per client book (job-scoped rows never default)
create unique index if not exists idx_client_locations_default
  on client_locations(client_id) where is_default and job_id is null;

-- ── item_destinations ──────────────────────────────────────────────────
create table if not exists item_destinations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  item_id uuid not null references items(id) on delete cascade,
  location_id uuid not null references client_locations(id) on delete restrict,
  qtys jsonb not null default '{}'::jsonb,              -- per-size share of the item going to this location
  sort_order int not null default 0,                    -- fill order when a vendor ships short (R7)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (item_id, location_id)
);
create index if not exists idx_item_destinations_item on item_destinations(item_id);

-- ── jobs / shipments columns ───────────────────────────────────────────
alter table jobs add column if not exists ship_to_location_id uuid references client_locations(id) on delete set null;
alter table shipments add column if not exists location_id uuid references client_locations(id) on delete set null;
alter table shipments add column if not exists ship_to_snapshot text;   -- frozen at ship/forward; what the slip prints

-- direction: inbound (vendor→HPD) · outbound (HPD→client) · direct (vendor→client)
alter table shipments drop constraint if exists shipments_direction_check;
alter table shipments add constraint shipments_direction_check
  check (direction in ('inbound','outbound','direct'));

-- ── RLS + grants + company stamp (house pattern, migs 059/117/168) ──────
do $$
declare tbl text;
begin
  foreach tbl in array array['client_locations', 'item_destinations'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format('create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format('create trigger fill_company_id before insert on %I for each row execute function default_company_id_to_hpd()', tbl);
  end loop;
end $$;

notify pgrst, 'reload schema';
