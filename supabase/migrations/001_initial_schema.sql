-- OpsHub V2 Initial Schema
-- Run this in Supabase SQL Editor

-- Enable UUID extension
create extension if not exists "pgcrypto";

-- CLIENTS
create table clients (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client_type   text check (client_type in ('artist','brand','corporate','label')),
  default_terms text check (default_terms in ('net_15','net_30','deposit_balance','prepaid')),
  notes         text,
  created_at    timestamptz default now()
);

-- CONTACTS
create table contacts (
  id          uuid primary key default gen_random_uuid(),
  client_id   uuid references clients(id) on delete cascade,
  name        text not null,
  email       text,
  phone       text,
  role_label  text,
  is_primary  boolean default false,
  created_at  timestamptz default now()
);

-- JOB TEMPLATES
create table job_templates (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  client_id        uuid references clients(id),
  job_type         text,
  default_items    jsonb default '[]',
  default_contacts jsonb default '[]',
  payment_terms    text,
  notes            text,
  created_at       timestamptz default now()
);

-- JOBS
create table jobs (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid references clients(id),
  parent_job_id    uuid references jobs(id),
  template_id      uuid references job_templates(id),
  job_number       text unique not null,
  job_type         text not null check (job_type in ('tour','webstore','corporate','brand')),
  title            text not null,
  phase            text default 'intake' check (phase in (
                     'intake','pre_production','production','receiving','shipping','complete','on_hold','cancelled'
                   )),
  priority         text default 'normal' check (priority in ('normal','high','urgent')),
  payment_terms    text check (payment_terms in ('net_15','net_30','deposit_balance','prepaid')),
  contract_status  text default 'not_sent' check (contract_status in ('not_sent','sent','signed','waived')),
  notes            text,
  target_ship_date date,
  est_completion   date,
  type_meta        jsonb default '{}',
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

create trigger jobs_updated_at before update on jobs
  for each row execute function update_updated_at();

-- Auto-generate job number
create sequence job_number_seq start 1;

create or replace function generate_job_number()
returns trigger as $$
begin
  new.job_number = 'HPD-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('job_number_seq')::text, 4, '0');
  return new;
end;
$$ language plpgsql;

create trigger jobs_job_number before insert on jobs
  for each row when (new.job_number is null or new.job_number = '')
  execute function generate_job_number();

-- JOB CONTACTS
create table job_contacts (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs(id) on delete cascade,
  contact_id  uuid references contacts(id),
  role_on_job text check (role_on_job in ('primary','billing','creative','logistics','cc')),
  notify      boolean default true,
  unique(job_id, contact_id)
);

-- DECORATORS
create table decorators (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  capabilities   text[] default '{}',
  location       text,
  lead_time_days int,
  contact_name   text,
  contact_email  text,
  contact_phone  text,
  notes          text,
  external_token text unique,
  created_at     timestamptz default now()
);

-- ITEMS
create table items (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid references jobs(id) on delete cascade,
  name           text not null,
  blank_vendor   text,
  blank_sku      text,
  garment_type   text check (garment_type in (
                   'tee','hoodie','longsleeve','crewneck','hat','beanie','tote','patch','poster','sticker','custom'
                 )),
  status         text default 'tbd' check (status in ('confirmed','tbd')),
  artwork_status text default 'not_started' check (artwork_status in ('not_started','in_progress','approved','n_a')),
  artwork_url    text,
  cost_per_unit  numeric(10,2),
  sell_per_unit  numeric(10,2),
  margin_pct     numeric(5,2) generated always as (
                   case when sell_per_unit > 0
                   then round(((sell_per_unit - cost_per_unit) / sell_per_unit * 100)::numeric, 2)
                   else null end
                 ) stored,
  notes          text,
  sort_order     int default 0,
  created_at     timestamptz default now()
);

-- BUY SHEET LINES
create table buy_sheet_lines (
  id                      uuid primary key default gen_random_uuid(),
  item_id                 uuid references items(id) on delete cascade,
  size                    text not null,
  qty_ordered             int default 0,
  qty_shipped_from_vendor int default 0,
  qty_received_at_hpd     int default 0,
  qty_shipped_to_customer int default 0,
  unique(item_id, size)
);

-- DECORATOR ASSIGNMENTS
create table decorator_assignments (
  id                     uuid primary key default gen_random_uuid(),
  item_id                uuid references items(id) on delete cascade,
  decorator_id           uuid references decorators(id),
  decoration_type        text check (decoration_type in (
                           'screen_print','embroidery','patch','cut_sew','dtg','sublimation','heat_transfer'
                         )),
  pipeline_stage         text default 'blanks_ordered' check (pipeline_stage in (
                           'blanks_ordered','blanks_shipped','blanks_received',
                           'strikeoff_approval','in_production','shipped'
                         )),
  strikeoff_status       text default 'not_needed' check (strikeoff_status in (
                           'not_needed','pending','approved','revision_requested'
                         )),
  sent_to_decorator_date date,
  est_completion_date    date,
  actual_completion_date date,
  tracking_number        text,
  cost                   numeric(10,2),
  notes                  text,
  created_at             timestamptz default now(),
  updated_at             timestamptz default now()
);

create trigger decorator_assignments_updated_at before update on decorator_assignments
  for each row execute function update_updated_at();

-- SHIPMENTS
create table shipments (
  id                   uuid primary key default gen_random_uuid(),
  job_id               uuid references jobs(id) on delete cascade,
  shipment_type        text check (shipment_type in (
                         'blanks_to_hpd','blanks_to_decorator','from_decorator_to_hpd','to_customer','to_venue'
                       )),
  origin               text,
  destination          text,
  carrier              text,
  tracking_number      text,
  ship_date            date,
  est_delivery         date,
  actual_delivery      date,
  status               text default 'pending' check (status in ('pending','in_transit','delivered','exception')),
  shipstation_order_id text,
  notes                text,
  created_at           timestamptz default now()
);

create table shipment_items (
  id          uuid primary key default gen_random_uuid(),
  shipment_id uuid references shipments(id) on delete cascade,
  item_id     uuid references items(id),
  size        text,
  qty         int
);

-- PAYMENT RECORDS
create table payment_records (
  id             uuid primary key default gen_random_uuid(),
  job_id         uuid references jobs(id) on delete cascade,
  qb_invoice_id  text,
  invoice_number text,
  type           text check (type in ('deposit','balance','full_payment','refund')),
  amount         numeric(10,2),
  status         text check (status in ('draft','sent','viewed','partial','paid','overdue','void')),
  due_date       date,
  paid_date      date,
  synced_at      timestamptz,
  created_at     timestamptz default now()
);

-- INVENTORY (webstore only)
create table inventory_records (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid references items(id) on delete cascade,
  size              text not null,
  qty_on_hand       int default 0,
  qty_allocated     int default 0,
  qty_available     int generated always as (qty_on_hand - qty_allocated) stored,
  reorder_threshold int,
  bin_location      text,
  updated_at        timestamptz default now(),
  unique(item_id, size)
);

-- PROFILES (extends auth.users)
create table profiles (
  id                  uuid primary key references auth.users(id) on delete cascade,
  full_name           text,
  role                text default 'readonly' check (role in (
                        'manager','production','warehouse','shipping','sales','readonly'
                      )),
  assigned_client_ids uuid[] default '{}',
  created_at          timestamptz default now()
);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, role)
  values (new.id, new.raw_user_meta_data->>'full_name', 'readonly');
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ALERTS
create table alerts (
  id                      uuid primary key default gen_random_uuid(),
  job_id                  uuid references jobs(id) on delete cascade,
  item_id                 uuid references items(id),
  decorator_assignment_id uuid references decorator_assignments(id),
  alert_type              text not null,
  severity                text check (severity in ('critical','warning','info')),
  message                 text not null,
  due_date                date,
  assigned_roles          text[] not null,
  is_dismissed            boolean default false,
  dismissed_by            uuid references profiles(id),
  created_at              timestamptz default now(),
  resolved_at             timestamptz
);

-- AUDIT LOG
create table audit_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references profiles(id),
  entity_type text not null,
  entity_id   uuid not null,
  action      text not null,
  field       text,
  old_value   text,
  new_value   text,
  created_at  timestamptz default now()
);

-- INDEXES for common queries
create index jobs_phase_idx on jobs(phase);
create index jobs_client_idx on jobs(client_id);
create index jobs_ship_date_idx on jobs(target_ship_date);
create index items_job_idx on items(job_id);
create index items_status_idx on items(status);
create index decorator_assignments_item_idx on decorator_assignments(item_id);
create index alerts_job_idx on alerts(job_id);
create index alerts_dismissed_idx on alerts(is_dismissed) where is_dismissed = false;
