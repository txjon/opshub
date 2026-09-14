-- 178: atomic jsonb merge for jobs.type_meta (Sep 14 2026).
--
-- Every server-side writer did read → spread → write the whole blob. Mig 176
-- stops a wipe, but two writers landing in the same second still overwrite
-- each other's key (last write wins; the loser's change silently vanishes).
-- This function merges IN the database in one statement: no read, no race.
-- Adds/overwrites keys only — it can never drop one, so the 176 guard is
-- satisfied by construction. To clear a key, patch it to null.
create or replace function patch_job_type_meta(p_job_id uuid, p_patch jsonb)
returns jsonb
language sql security definer set search_path = public as $$
  update jobs
     set type_meta = coalesce(type_meta, '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)
   where id = p_job_id
   returning type_meta;
$$;
revoke all on function patch_job_type_meta(uuid, jsonb) from public;
grant execute on function patch_job_type_meta(uuid, jsonb) to service_role, authenticated;
