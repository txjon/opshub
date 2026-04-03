-- Staging boards: product ideation sheets per client engagement
create table if not exists staging_boards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text not null,
  share_token text unique not null default encode(gen_random_bytes(16), 'hex'),
  share_password_hash text,
  summary_label text default 'FOG WORKING',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Items on the board
create table if not exists staging_items (
  id uuid primary key default gen_random_uuid(),
  board_id uuid references staging_boards(id) on delete cascade,
  item_name text not null default '',
  qty integer,
  unit_cost numeric(10,2),
  retail numeric(10,2),
  status text default 'Pending',
  notes text,
  sort_order integer default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Images attached to items
create table if not exists staging_item_images (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references staging_items(id) on delete cascade,
  storage_path text not null,
  filename text,
  created_at timestamptz default now()
);

-- RLS policies
alter table staging_boards enable row level security;
alter table staging_items enable row level security;
alter table staging_item_images enable row level security;

create policy "Authenticated users can manage staging_boards" on staging_boards for all using (auth.role() = 'authenticated');
create policy "Authenticated users can manage staging_items" on staging_items for all using (auth.role() = 'authenticated');
create policy "Authenticated users can manage staging_item_images" on staging_item_images for all using (auth.role() = 'authenticated');

-- Storage bucket (run in Supabase dashboard if this fails)
-- insert into storage.buckets (id, name, public) values ('staging-images', 'staging-images', false);
