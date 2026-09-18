-- 183: invoice identity columns are THE truth (phase 4 of the Invoice Identity
-- Migration, Sep 17 2026). Every reader and writer moved to
-- jobs.qb_invoice_number / qb_invoice_id in code. This migration:
--   1. strips the two keys from every type_meta (mig 176's guard is told this
--      drop is deliberate), keeping the previous blob in job_type_meta_history;
--   2. drops the temporary blob→column sync from mig 182;
--   3. removes the two names from the mig-176 identity list;
--   4. installs a STRIP trigger: any write that puts the keys back into the
--      blob has them removed before the row is saved. Stripped, not refused —
--      a job page open across the deploy still saves. The strip is logged.

-- 1. deliberate strip (opt out of the 176 guard for this transaction only)
select set_config('opshub.allow_type_meta_key_drop', 'on', true);
update jobs
   set type_meta = type_meta - 'qb_invoice_number' - 'qb_invoice_id'
 where type_meta ? 'qb_invoice_number' or type_meta ? 'qb_invoice_id';

-- 2. temporary sync is done
drop trigger if exists jobs_invoice_blob_sync on jobs;
drop function if exists jobs_invoice_blob_sync();

-- 3. guard list without the two moved keys
create or replace function jobs_type_meta_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  k text;
  identity_keys text[] := array[
    'po_sent_vendors', 'po_sent_dates', 'approval_snapshot', 'po_cost_snapshots', 'po_ship_dates'
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

-- 4. the keys can never creep back into the blob (insert or update)
create or replace function jobs_invoice_keys_strip() returns trigger
language plpgsql as $$
begin
  if new.type_meta ? 'qb_invoice_number' or new.type_meta ? 'qb_invoice_id' then
    raise notice 'type_meta: stripped qb_invoice_number/qb_invoice_id from job % — those live in columns (mig 183)', new.id;
    new.type_meta := new.type_meta - 'qb_invoice_number' - 'qb_invoice_id';
  end if;
  return new;
end $$;
drop trigger if exists jobs_invoice_keys_strip on jobs;
-- name sorts before jobs_type_meta_guard so the strip runs first and the guard sees the final blob
create trigger jobs_invoice_keys_strip before insert or update of type_meta on jobs
  for each row execute function jobs_invoice_keys_strip();
