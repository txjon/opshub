-- UPS inbound-freight import: external carrier tracking # on cost_entries, used
-- as the dedup key (source + vendor_invoice_number + ext_tracking) so weekly
-- re-uploads never double-count, and for audit/display in the Shipping view.
alter table cost_entries add column if not exists ext_tracking text;
comment on column cost_entries.ext_tracking is
  'External carrier tracking # (UPS freight import). Dedup key with source + vendor_invoice_number.';
