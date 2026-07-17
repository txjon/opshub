-- 124: live inbound tracking (EasyPost) — plan locked 2026-07-16 (D1-D4).
--
-- One EasyPost tracker per shipments row (a row = one physical box).
-- delivered_at is a CARRIER signal; received_at stays human-only, always.
-- tracking_events = scan history; scan_key unique = webhook idempotency at
-- the database (retries + event replays no-op on conflict).

alter table shipments add column if not exists easypost_tracker_id text;
alter table shipments add column if not exists carrier_status text;          -- EasyPost status: pre_transit/in_transit/out_for_delivery/delivered/...
alter table shipments add column if not exists carrier_detected text;        -- carrier EasyPost identified (may differ from typed carrier)
alter table shipments add column if not exists est_delivery_date date;       -- carrier's estimate
alter table shipments add column if not exists est_delivery_updated_at timestamptz; -- freshness for Rule B (freshest signal wins)
alter table shipments add column if not exists expected_arrival_edited_at timestamptz; -- when a human last edited expected_arrival (Rule B)
alter table shipments add column if not exists delivered_at timestamptz;     -- carrier-reported delivery. NEVER received_at.
alter table shipments add column if not exists last_scan jsonb;              -- {status, description, location, at}
alter table shipments add column if not exists tracking_error text;          -- EasyPost rejected the number; no auto-retry
alter table shipments add column if not exists tracker_attempted_at timestamptz; -- guard: one registration attempt per box
alter table shipments add column if not exists delivered_not_found_at timestamptz; -- human flag: carrier says delivered, box never appeared

create index if not exists idx_shipments_easypost_tracker on shipments(easypost_tracker_id);
create index if not exists idx_shipments_delivered_unreceived on shipments(delivered_at) where delivered_at is not null and status != 'received';

create table if not exists tracking_events (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references shipments(id) on delete cascade,
  easypost_tracker_id text,
  scan_key text not null unique,      -- md5(tracker|datetime|status|message) — idempotency
  status text,
  description text,
  location text,
  occurred_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_tracking_events_shipment on tracking_events(shipment_id, occurred_at);

grant all on table tracking_events to authenticated, service_role;

alter table tracking_events enable row level security;
drop policy if exists tracking_events_team on tracking_events;
create policy tracking_events_team on tracking_events for all to authenticated using (true) with check (true);
