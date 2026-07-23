-- 145: THE LAB STUDIO — an isolated sandbox for the design-approval ping-pong
-- (Jon, Jul 22 2026). Walled off from production: its own tables, its own
-- storage bucket. Nothing here reads or writes jobs / items / art_briefs, so
-- the team (Drake, Taylor, Corey) can break it freely without touching live
-- data. Graduation-ready — when the flow is proven, it maps onto the real
-- tables. All access is service-role via /api/lab/* (RLS on, no policies).

create table if not exists lab_clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  token text not null unique,                 -- magic-link token (API-generated)
  created_at timestamptz not null default now()
);

create table if not exists lab_threads (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references lab_clients(id) on delete cascade,
  title text not null,
  -- the studio's whole state machine: HPD's court (working) → client's court
  -- (with_client) → locked (approved). A client "request changes" drops it back
  -- to working. No other states — nowhere to dead-end.
  state text not null default 'working' check (state in ('working','with_client','approved')),
  initiated_by text not null default 'hpd' check (initiated_by in ('hpd','client')),
  approved_at timestamptz,
  approved_by text,
  approved_file_url text,                      -- the exact art that got locked
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lab_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lab_threads(id) on delete cascade,
  sender_role text not null check (sender_role in ('client','hpd')),
  sender_name text,
  body text,
  -- the wall: client-visible vs internal. Replaces the old two-room model.
  visibility text not null default 'client' check (visibility in ('client','internal')),
  file_url text,
  file_name text,
  kind text not null default 'comment' check (kind in ('comment','version','change_request','approval','submission')),
  created_at timestamptz not null default now()
);

create index if not exists lab_threads_client_idx on lab_threads(client_id);
create index if not exists lab_messages_thread_idx on lab_messages(thread_id, created_at);

alter table lab_clients enable row level security;
alter table lab_threads enable row level security;
alter table lab_messages enable row level security;
-- Intentionally NO policies: every read/write goes through /api/lab/* on the
-- service role, which bypasses RLS. The anon client can touch nothing.
