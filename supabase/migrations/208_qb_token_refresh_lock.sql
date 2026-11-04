-- 208: one QuickBooks token renewal at a time (Nov 4 2026). QB disconnected
-- three nights running; the Nov 4 log showed two renewals overlapping at the
-- 1:10am rotation. Intuit kills the connection when the token is renewed from
-- a value it has just replaced, so renewals must never overlap.
--   refresh_lock_until / refresh_lock_owner: a lease taken by a conditional
--   update before calling Intuit (lib/quickbooks doRefresh). Only the lease
--   owner may save the renewed token; a crashed holder's lease lapses.
--   qb_token_events.instance: which server process wrote the event, so two
--   overlapping renewals are told apart.
alter table public.qb_tokens add column if not exists refresh_lock_until timestamptz;
alter table public.qb_tokens add column if not exists refresh_lock_owner text;
alter table public.qb_token_events add column if not exists instance text;

-- The write log fires on token changes only, not on lease take/release.
drop trigger if exists qb_tokens_log_write on public.qb_tokens;
create trigger qb_tokens_log_write after insert or update of access_token, refresh_token on public.qb_tokens
  for each row execute function public.log_qb_token_write();
notify pgrst, 'reload schema';
