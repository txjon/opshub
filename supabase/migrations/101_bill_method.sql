-- 101: how a cost was paid — invoice (AP bill, pay later), credit_card (charged on
-- file, already paid), or other. Matters downstream: a CC charge is NOT an open
-- commitment or an AP bill to push to QB — it's a settled expense. Per-vendor
-- default so vendors that always CC-charge (e.g. Downeast) pre-select it.
alter table cost_entries
  add column if not exists bill_method text not null default 'invoice'
    check (bill_method in ('invoice', 'credit_card', 'other'));

alter table ap_vendors
  add column if not exists default_bill_method text not null default 'invoice'
    check (default_bill_method in ('invoice', 'credit_card', 'other'));

-- Downeast bills by charging the card on file (no invoice).
update ap_vendors set default_bill_method = 'credit_card'
where name ilike '%downeast%';
