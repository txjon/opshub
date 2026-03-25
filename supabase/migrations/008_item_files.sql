-- Item files — art file metadata, actual files live in Google Drive
create table item_files (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid references items(id) on delete cascade,
  file_name      text not null,
  stage          text not null check (stage in ('client_art','vector','mockup','proof','print_ready')),
  drive_file_id  text not null,
  drive_link     text not null,
  mime_type      text,
  file_size      bigint,
  approval       text default 'none' check (approval in ('none','pending','approved','revision_requested')),
  approved_at    timestamptz,
  notes          text,
  uploaded_by    uuid references auth.users(id),
  created_at     timestamptz default now()
);

-- Index for fast lookups by item
create index idx_item_files_item_id on item_files(item_id);

-- RLS
alter table item_files enable row level security;
create policy "Authenticated users can manage item files"
  on item_files for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');
