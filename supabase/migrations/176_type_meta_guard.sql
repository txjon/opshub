-- 176: jobs.type_meta is guarded AT THE DATABASE (Sep 11 2026).
--
-- type_meta is one jsonb blob carrying everything a job IS after intake: the
-- QB invoice link, the PO-sent record, the client approval snapshot, the
-- per-vendor cost snapshots variance baselines on. Every writer read-merges-
-- writes the whole blob. On Sep 11 a ship-by edit on HPD-2608-032 read the job,
-- got nothing back (one transient failure), spread {} and wrote back a blob
-- with a single key. Invoice #4454 and the PO history vanished; freight stopped
-- matching; the hub lost the approval. App-side guards (lib/job-type-meta)
-- shrink the odds. This makes it impossible regardless of which code writes:
--
--   1. history: every change to type_meta keeps the previous blob. Any future
--      damage is one query to undo.
--   2. refusal: an UPDATE that DROPS an identity key the row already had is
--      rejected. Setting a key to null is allowed (void/cancel do that); making
--      the key disappear is not — that only ever happens by accident.
--      Deliberate admin cleanups can opt out per-transaction:
--        select set_config('opshub.allow_type_meta_key_drop', 'on', true);

create table if not exists job_type_meta_history (
  id bigserial primary key,
  job_id uuid not null references jobs(id) on delete cascade,
  old_meta jsonb,
  new_meta jsonb,
  changed_by uuid,
  changed_at timestamptz not null default now()
);
create index if not exists job_type_meta_history_job_idx on job_type_meta_history (job_id, changed_at desc);

alter table job_type_meta_history enable row level security;
drop policy if exists job_type_meta_history_read on job_type_meta_history;
create policy job_type_meta_history_read on job_type_meta_history
  for select to authenticated using (true);
grant all on job_type_meta_history to service_role;
grant select on job_type_meta_history to authenticated;
grant usage, select on sequence job_type_meta_history_id_seq to service_role;

create or replace function jobs_type_meta_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  identity_keys text[] := array[
    'qb_invoice_number', 'qb_invoice_id', 'po_sent_vendors', 'po_sent_dates',
    'approval_snapshot', 'po_cost_snapshots', 'po_ship_dates'
  ];
begin
  if new.type_meta is not distinct from old.type_meta then
    return new;
  end if;
  if coalesce(current_setting('opshub.allow_type_meta_key_drop', true), '') <> 'on' then
    foreach k in array identity_keys loop
      if (old.type_meta ? k) and not (coalesce(new.type_meta, '{}'::jsonb) ? k) then
        raise exception 'type_meta write refused: it would drop "%" from job % (a whole-blob overwrite built on a failed read). Merge into the existing type_meta; set the key to null if you mean to clear it.', k, old.id
          using errcode = 'check_violation';
      end if;
    end loop;
  end if;
  insert into job_type_meta_history (job_id, old_meta, new_meta, changed_by)
    values (old.id, old.type_meta, new.type_meta, nullif(current_setting('request.jwt.claim.sub', true), '')::uuid);
  return new;
end $$;

drop trigger if exists jobs_type_meta_guard on jobs;
create trigger jobs_type_meta_guard before update of type_meta on jobs
  for each row execute function jobs_type_meta_guard();
