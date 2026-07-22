-- 139: history ↔ OpsHub overlap (Jon, Jul 22). The QB export runs through the
-- OpsHub era, so invoices OpsHub pushed exist in BOTH history_sales and live
-- jobs. Stamp the overlap (matched on doc_num = jobs qb_invoice_number);
-- aggregate readers exclude stamped rows. Raw rows stay — history is truth.
alter table history_sales add column if not exists opshub_job_id uuid references jobs(id) on delete set null;
create index if not exists idx_hist_sales_overlap on history_sales(opshub_job_id);
