-- Missing-file tripwire (Sep 2026).
-- 45 Drive files referenced by live OpsHub records turned out to be gone —
-- deleted months ago by the delete paths Phase 0 closed, and nobody knew until
-- a client's catalog showed blank tiles. Nothing ever checked that a file we
-- point at still exists.
--
-- This table is the rolling record of that check: every distinct Drive file id
-- OpsHub references, when it was last verified, and whether it was there.
-- The health cron verifies a slice each run so the whole library is covered
-- daily without a long job, and reports anything missing.
create table if not exists public.file_health (
  drive_file_id    text primary key,
  last_checked_at  timestamptz not null default now(),
  missing          boolean not null default false,
  first_missing_at timestamptz,
  file_name        text,
  stage            text,
  item_id          uuid,
  note             text
);

create index if not exists file_health_checked_idx on public.file_health (last_checked_at asc);
create index if not exists file_health_missing_idx on public.file_health (missing) where missing;

alter table public.file_health enable row level security;
