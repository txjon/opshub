-- UPS freight import: pickup/ship date on the charge, for display in the
-- "Needs a match" reconciliation queue.
alter table cost_entries add column if not exists ext_date text;
