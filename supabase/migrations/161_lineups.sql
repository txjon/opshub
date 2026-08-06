-- 161: THE LINEUP (Jon, Aug 6) — the menu moment. Many-at-once mockup rounds
-- on a design: bulk-uploaded numbered options, client taps picks as a BATCH
-- with a note, picks mint CHILD designs (flip lineage) that live the normal
-- studio life. Kills the Photoshop-grid-and-text-me-numbers ritual.
create table if not exists lineups (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references art_briefs(id) on delete cascade,
  sent_at timestamptz,            -- null = draft (editable verification)
  picks_at timestamptz,           -- client committed their batch
  closed_at timestamptz,          -- children minted; round archived
  client_note text,               -- the note riding the batch
  created_by text,
  created_at timestamptz not null default now()
);
create index if not exists lineups_brief_idx on lineups(brief_id, created_at desc);

create table if not exists lineup_options (
  id uuid primary key default gen_random_uuid(),
  lineup_id uuid not null references lineups(id) on delete cascade,
  position int not null,          -- the menu number (01, 02, …)
  label text,                     -- optional name ("Washed Navy")
  drive_file_id text,
  preview_drive_file_id text,
  drive_link text,
  mime_type text,
  file_size int,
  picked boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists lineup_options_lineup_idx on lineup_options(lineup_id, position);

-- child lineage on designs themselves (the flip model at brief level)
alter table art_briefs add column if not exists parent_brief_id uuid references art_briefs(id) on delete set null;

alter table lineups enable row level security;
alter table lineup_options enable row level security;
-- No policies: service-role via /api/studio/* + token-verified portal routes.
