-- 205: QuickBooks login-token audit trail (Nov 3 2026). QB disconnected two
-- nights running (invalid_grant) with nothing in OpsHub's logs to say what
-- invalidated the token. One row per connect / renewal / failure, written by
-- lib/quickbooks from ANY process (prod, preview, local dev, scripts) so the
-- next disconnect names its cause. Tokens are never stored: fingerprints only.
create table if not exists public.qb_token_events (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  event text not null,        -- connect | refresh | refresh_superseded | refresh_failed | save_failed | alert_sent
  old_fp text,                -- sha256 prefix of the refresh token used
  new_fp text,                -- sha256 prefix of the refresh token received
  host text,                  -- vercel env + url, or the machine name
  caller text,                -- first app frame of the stack
  detail text
);
create index if not exists qb_token_events_at on public.qb_token_events (at desc);
alter table public.qb_token_events enable row level security;
grant all on table public.qb_token_events to service_role;
notify pgrst, 'reload schema';
