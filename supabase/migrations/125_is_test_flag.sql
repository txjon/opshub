-- 125: jobs.is_test — Jon's decision 2026-07-17 (roadmap Tier 2): test/e2e
-- sandbox jobs are excluded from every P&L rollup via lib/revenue pnlJobs
-- (one policy: is_inventory + cancelled + is_test).
alter table jobs add column if not exists is_test boolean not null default false;

-- Flag the known sandbox jobs: the Playwright test client's jobs + the two
-- e2e job numbers hardcoded in lib/v2-flags.ts V2_TEST_JOBS.
update jobs set is_test = true
where client_id in (select id from clients where name = 'Playwright Test Co')
   or job_number in ('HPD-2605-054', 'HPD-2606-050');

-- Future-proof: test jobs are created/deleted constantly by the seed/reset
-- scripts — flag them AT CREATION so the policy never depends on a periodic
-- sweep. Any job for the Playwright client is born is_test.
create or replace function set_is_test_from_client() returns trigger as $$
begin
  if new.client_id in (select id from clients where name = 'Playwright Test Co') then
    new.is_test := true;
  end if;
  return new;
end; $$ language plpgsql;
drop trigger if exists trg_jobs_is_test on jobs;
create trigger trg_jobs_is_test before insert on jobs
  for each row execute function set_is_test_from_client();
