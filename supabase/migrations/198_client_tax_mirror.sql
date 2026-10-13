-- 198: clients mirror their QuickBooks sales-tax status (Oct 13 2026).
--
-- clients.tax_exempt was a hand-set checkbox nothing enforced: the QB push
-- never read it, QB taxed from its own customer record, and 13 of 28
-- "exempt" clients were taxable in QB ($1,954 of tax on their invoices).
-- QB's customer record is now THE switch; OpsHub mirrors it
-- (lib/client-tax-sync, 6-hourly + on demand). A verified resale certificate
-- will be the only way to change it (client info form, next).
alter table clients add column if not exists qb_resale_num text;
alter table clients add column if not exists tax_synced_at timestamptz;
notify pgrst, 'reload schema';
