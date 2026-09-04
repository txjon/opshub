-- 170: cost_entries source 'pre_opshub' (Sep 4 2026) — the Mark-fully-billed
-- close-out for early POs billed before OpsHub AP existed: records the bill
-- AT the PO amount so margin stays honest. Never pushed to QB (gate in
-- /api/qb/bill); exists for job costing truth only.
alter table cost_entries drop constraint if exists cost_entries_source_check;
alter table cost_entries add constraint cost_entries_source_check
  check (source in ('decorator_invoice','freight','manual_freight','blanks','ups_inbound','ups_outbound','pre_opshub'));
