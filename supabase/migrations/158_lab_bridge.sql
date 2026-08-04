-- 158: THE BRIDGE (Jon sign-off Aug 4) — the Lab graduates onto real identity
-- and real production.
--
-- 1. clients.is_lead — the decided lead flag: a Lab-born lead is a REAL client
--    row immediately, hidden from operational lists until their first job.
-- 2. The flip is a DB trigger on jobs insert so EVERY door (fork, bridge,
--    jobs/new, duplicate, reorder) flips it — no per-path wiring.
-- 3. lab_clients.client_id — lab clients become pointers at real clients
--    (shared identity; nothing to match at graduation).
-- 4. lab_order_requests.job_id — the bridge stamps which job an ask became.

alter table clients add column if not exists is_lead boolean not null default false;

create or replace function flip_lead_on_first_job() returns trigger
language plpgsql as $$
begin
  if NEW.client_id is not null then
    update clients set is_lead = false where id = NEW.client_id and is_lead;
  end if;
  return NEW;
end $$;
drop trigger if exists jobs_flip_lead on jobs;
create trigger jobs_flip_lead after insert on jobs
  for each row execute function flip_lead_on_first_job();

alter table lab_clients add column if not exists client_id uuid references clients(id) on delete set null;
alter table lab_order_requests add column if not exists job_id uuid references jobs(id) on delete set null;
