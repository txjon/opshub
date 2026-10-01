-- 190: THE LINE SHEET (Jon, Sep 30 2026 — design map artifact 4931e236).
-- A client-level product line presented like a webstore and worked like a
-- document: sections of named items (persistent identity, multi-image),
-- explicit published versions (v1, v2, …), and a client thumb per item that
-- CARRIES across versions until the item visually changes. Standalone from
-- the per-design lineup (mig 161), which stays untouched as reference.
create table if not exists line_sheets (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  season text,                              -- "[FALL / 2026]"
  status text not null default 'working' check (status in ('working','final')),
  current_version int not null default 0,   -- 0 = never published (draft only)
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists line_sheets_client_idx on line_sheets(client_id, created_at desc);

create table if not exists line_sheet_sections (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references line_sheets(id) on delete cascade,
  name text not null,
  sort int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists line_sheet_sections_sheet_idx on line_sheet_sections(sheet_id, sort);

create table if not exists line_sheet_items (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references line_sheets(id) on delete cascade,
  section_id uuid references line_sheet_sections(id) on delete set null,  -- null = sorting tray
  name text,
  sort int not null default 0,
  -- [{id, driveId, name}] — order matters: first = cover; front/back nest
  images jsonb not null default '[]',
  added_in int,                             -- version that introduced it (null until first publish)
  updated_in int,                           -- version that last visually changed it
  dropped boolean not null default false,   -- off the sheet (kept as history)
  dropped_in int,
  -- the client's thumb RIDES THE ITEM, not the version (the carry rule)
  client_thumb text check (client_thumb in ('up','down')),
  client_thumb_at timestamptz,
  client_thumb_version int,
  created_at timestamptz not null default now()
);
create index if not exists line_sheet_items_sheet_idx on line_sheet_items(sheet_id, sort);

create table if not exists line_sheet_versions (
  id uuid primary key default gen_random_uuid(),
  sheet_id uuid not null references line_sheets(id) on delete cascade,
  n int not null,
  note text,                                -- what changed, in our words
  snapshot jsonb not null,                  -- frozen {sections, items} as published
  published_at timestamptz not null default now(),
  published_by text,
  unique (sheet_id, n)
);

alter table line_sheets enable row level security;
alter table line_sheet_sections enable row level security;
alter table line_sheet_items enable row level security;
alter table line_sheet_versions enable row level security;
-- No policies: service-role only via /api/studio/line-sheets* and the
-- token-verified client hub routes (the studio/lab table pattern).
