-- A job flagged is_inventory is a bulk stock/blank purchase (e.g. blank hats
-- bought to decorate + sell across future jobs), NOT a client sale. It is
-- excluded from every P&L rollup (revenue, cost, margin, profit) on Reports,
-- God Mode, and the client hub — counting it would drag margin now AND
-- double-count later, when the jobs that actually sell the stock carry the
-- per-unit blank cost via normal costing. The job still exists for
-- receiving / warehouse / PO so the stock can be ordered and used.
alter table jobs add column if not exists is_inventory boolean not null default false;
comment on column jobs.is_inventory is 'Bulk stock/blank purchase, not a client sale. Excluded from all P&L rollups; cost rides the future jobs that decorate+sell the stock.';
