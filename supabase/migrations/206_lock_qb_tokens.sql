-- 206: qb_tokens was open to the public anon key (Nov 3 2026 review). Mig 019's
-- "Service role can manage qb_tokens" policy had no TO clause, so USING (true)
-- applied to anon + authenticated: anyone holding the browser's anon key could
-- read the live QB tokens and likely overwrite them. service_role bypasses RLS,
-- so the policy was never needed. Also: a trigger logs EVERY write to the token
-- row (scripts, other processes, any role) into qb_token_events, so a
-- disconnect can always be traced, not just writes through lib/quickbooks.
drop policy if exists "Service role can manage qb_tokens" on public.qb_tokens;
revoke all on table public.qb_tokens from anon, authenticated;
revoke all on table public.qb_token_events from anon, authenticated;
grant all on table public.qb_tokens to service_role;

create or replace function public.log_qb_token_write() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.qb_token_events (event, old_fp, new_fp, host, detail)
  values (
    'db_write',
    case when tg_op = 'UPDATE' then left(encode(sha256(convert_to(old.refresh_token, 'UTF8')), 'hex'), 10) end,
    left(encode(sha256(convert_to(new.refresh_token, 'UTF8')), 'hex'), 10),
    'db:' || coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), current_user),
    tg_op || ' expires ' || new.expires_at::text
  );
  return new;
end $$;
drop trigger if exists qb_tokens_log_write on public.qb_tokens;
create trigger qb_tokens_log_write after insert or update on public.qb_tokens
  for each row execute function public.log_qb_token_write();
revoke execute on function public.log_qb_token_write() from public, anon, authenticated;
notify pgrst, 'reload schema';
