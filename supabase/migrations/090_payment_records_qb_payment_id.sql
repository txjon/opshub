-- payment_records.qb_payment_id — the QuickBooks Payment transaction id.
--
-- The QB payment webhook used to dedup on (job_id, amount, paid_date). But
-- QuickBooks caps each payment at $100k, so a large invoice gets paid as
-- several identical $100k payments within minutes. The amount+date dedup
-- treated those as duplicates and recorded only the first — silently
-- dropping the rest (e.g. FOG x 13H invoice 4348: 4×$100k in QB, 1 recorded).
--
-- Storing the QB Payment id gives the webhook a stable per-payment identity
-- to dedup on instead. Nullable: legacy rows + manual entries won't have it.
alter table payment_records add column if not exists qb_payment_id text;

create index if not exists idx_payment_records_qb_payment_id
  on payment_records(qb_payment_id) where qb_payment_id is not null;
