-- HPD Bill Number — OpsHub's own sequential bill identifier (job-number style:
-- HPD-B-YYMM-NNN), stamped on a bill's lines and pushed to QB as the Bill no.
-- Distinct from the per-line vendor_invoice_number (the vendor's own invoice #).
alter table cost_entries add column if not exists hpd_bill_number text;
create index if not exists cost_entries_hpd_bill_number_idx on cost_entries(hpd_bill_number);
