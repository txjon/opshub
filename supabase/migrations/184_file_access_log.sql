-- Phase 1, shadow mode (Sep 2026).
-- /api/files/view and /api/files/thumbnail currently serve ANY Drive file id to
-- anyone. Phase 1 adds an authorization check, but ~100 call sites across staff,
-- client hub, vendor portal and designer pages read through them, so enforcing
-- blind would risk blanking images for a client or a printer.
--
-- Instead the check runs in SHADOW first: it decides, records what it WOULD have
-- refused, and still serves the file. Once a few days of real traffic produce no
-- legitimate denials, it flips to enforcing. This table is that record.
create table if not exists public.file_access_log (
  id            uuid primary key default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  drive_file_id text not null,
  route         text not null,                 -- 'view' | 'thumbnail'
  audience      text,                          -- staff | client | vendor | designer | anonymous
  verdict       text not null,                 -- 'deny' (shadow) | 'blocked' (enforcing) | 'allow' (sampled)
  reason        text,                          -- why: unknown-file, wrong-audience, no-identity…
  owner_ref     text,                          -- table:id of the record that owns the file, when known
  user_id       uuid,                          -- staff user when there was a session
  token_hint    text,                          -- first 8 chars of any portal token used, for tracing
  path          text                           -- request path, for finding the call site
);

create index if not exists file_access_log_created_idx on public.file_access_log (created_at desc);
create index if not exists file_access_log_verdict_idx on public.file_access_log (verdict, created_at desc);

-- Service role writes it; nobody else needs it. No Data API grants on purpose:
-- this is an internal audit trail, read with the service key.
alter table public.file_access_log enable row level security;
