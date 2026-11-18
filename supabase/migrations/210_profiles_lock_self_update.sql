-- Staff could rewrite their own access. "users update own profile" (002)
-- let any signed-in user UPDATE their own row with no column limit, and
-- anon/authenticated held UPDATE on every column, so one REST call with the
-- public anon key and their own session could set role = 'owner',
-- is_god = true and any page_access. No app code writes profiles with a user
-- session: every write goes through /api/team on the service role.
drop policy if exists "users update own profile" on public.profiles;
revoke insert, update, delete on public.profiles from anon, authenticated;
