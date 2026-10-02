-- 196: true "on hold since" (Jon, Oct 2 2026). A trigger stamps
-- jobs.phase_timestamps.on_hold the moment phase ENTERS on_hold, whichever
-- path set it (job menu, scripts, anything later). Re-saving a held job never
-- moves the date; leaving and re-entering hold restamps. Pre-196 holds have
-- no stamp (the board falls back to last-touched and says so).
create or replace function jobs_stamp_on_hold() returns trigger
language plpgsql as $$
begin
  if new.phase = 'on_hold' and (tg_op = 'INSERT' or old.phase is distinct from 'on_hold') then
    new.phase_timestamps := coalesce(new.phase_timestamps, '{}'::jsonb)
      || jsonb_build_object('on_hold', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
  end if;
  return new;
end $$;

drop trigger if exists jobs_stamp_on_hold on jobs;
create trigger jobs_stamp_on_hold before insert or update of phase on jobs
  for each row execute function jobs_stamp_on_hold();

notify pgrst, 'reload schema';
