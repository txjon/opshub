-- Per-item messages for staging board mood board (2-way: internal + client)
create table if not exists staging_item_messages (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references staging_items(id) on delete cascade,
  sender_type text not null default 'internal' check (sender_type in ('internal', 'client')),
  sender_name text,
  message text not null,
  created_at timestamptz default now()
);

alter table staging_item_messages enable row level security;
create policy "Authenticated users can manage staging_item_messages" on staging_item_messages for all using (auth.role() = 'authenticated');

-- Allow anon access for client-facing share page
create policy "Anon can read staging_item_messages" on staging_item_messages for select using (true);
create policy "Anon can insert staging_item_messages" on staging_item_messages for insert with check (sender_type = 'client');
