-- Manual freight cost entries (LTL / CC charges keyed by PO → job), reconciled
-- alongside the UPS imports in the Freight view.
alter table cost_entries drop constraint if exists cost_entries_source_check;
alter table cost_entries add constraint cost_entries_source_check
  check (source in ('decorator_invoice','freight','blanks','ups_inbound','ups_outbound','manual_freight'));
