-- 038: client release planning — the Staging tab.
--
-- Reframed Apr 23. Staging is not a collab surface; it's a release-planning
-- tool. The client organizes items into release buckets ("April Drop",
-- "Summer 2026", etc.). No notes, no comments — just organizing. Release
-- buckets are client-owned: they create, rename, reorder, delete.
--
-- Legacy staging_boards stays in place (Jon's internal workspace) — these
-- tables are new and live alongside it.

create table if not exists client_releases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  target_date date,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_releases_client_idx
  on client_releases(client_id, sort_order);

create table if not exists release_items (
  id uuid primary key default gen_random_uuid(),
  release_id uuid not null references client_releases(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  -- One release per item — when the client drags an item into a new
  -- release, it moves out of the old one. This keeps the "where is this
  -- item planned?" question unambiguous.
  unique(item_id)
);

create index if not exists release_items_release_idx
  on release_items(release_id, sort_order);

-- RLS: service-role bypasses (which is what the portal APIs use via
-- supabase-js admin client). If we ever expose these directly via an
-- authenticated anon client, add owner-only policies here.
alter table client_releases enable row level security;
alter table release_items enable row level security;
