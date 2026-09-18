-- 182: invoice identity becomes real columns (phase 1 of the Invoice Identity
-- Migration, Sep 17 2026). qb_invoice_number / qb_invoice_id lived inside
-- jobs.type_meta; a whole-blob overwrite on Sep 11 erased a job's invoice link
-- (HPD-2608-032). Columns are the destination truth. THIS migration is
-- additive: code still reads/writes the blob until phase 3; a temporary sync
-- trigger keeps the columns current meanwhile so no second backfill is needed.
-- Mig 183 (phase 4) strips the blob keys, drops the sync, locks them out.

alter table jobs
  add column if not exists qb_invoice_number text,
  add column if not exists qb_invoice_id text;

create index if not exists jobs_qb_invoice_number_idx on jobs (qb_invoice_number)
  where qb_invoice_number is not null;
create index if not exists jobs_qb_invoice_id_idx on jobs (qb_invoice_id)
  where qb_invoice_id is not null;

-- Backfill from the blob (empty string → null; everything else verbatim).
update jobs set
  qb_invoice_number = nullif(type_meta->>'qb_invoice_number', ''),
  qb_invoice_id     = nullif(type_meta->>'qb_invoice_id', '')
where type_meta ? 'qb_invoice_number' or type_meta ? 'qb_invoice_id';

-- TEMPORARY (dropped in mig 183): while any code path still writes the two
-- keys into the blob, mirror a CHANGE of either key into its column.
create or replace function jobs_invoice_blob_sync() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or (new.type_meta->>'qb_invoice_number') is distinct from (old.type_meta->>'qb_invoice_number') then
    if new.type_meta ? 'qb_invoice_number' then new.qb_invoice_number := nullif(new.type_meta->>'qb_invoice_number', ''); end if;
  end if;
  if tg_op = 'INSERT' or (new.type_meta->>'qb_invoice_id') is distinct from (old.type_meta->>'qb_invoice_id') then
    if new.type_meta ? 'qb_invoice_id' then new.qb_invoice_id := nullif(new.type_meta->>'qb_invoice_id', ''); end if;
  end if;
  return new;
end $$;
drop trigger if exists jobs_invoice_blob_sync on jobs;
create trigger jobs_invoice_blob_sync before insert or update of type_meta on jobs
  for each row execute function jobs_invoice_blob_sync();
