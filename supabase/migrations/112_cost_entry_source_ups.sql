-- Allow UPS freight import sources on cost_entries (inbound production freight +
-- the future outbound distro account).
alter table cost_entries drop constraint if exists cost_entries_source_check;
alter table cost_entries add constraint cost_entries_source_check
  check (source in ('decorator_invoice','freight','blanks','ups_inbound','ups_outbound'));
