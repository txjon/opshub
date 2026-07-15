-- 121 — Phase 0: align the ledger to the agreed three-object model.
-- Both changes are ADDITIVE — no existing data is altered.
--
--   1. Pulls join the ledger. A pull is a quantity movement like any other, so
--      it stacks and reduces downstream via the derivation (lib/item-derivation).
--      pull_requests / pulled_inventory stay for the pull WORKFLOW (who/why/kind).
--   2. items.ship_final — persists the "this is the final shipment" decision:
--      THE single source of truth for "nothing more coming" (owed vs shortage).

alter table movements drop constraint if exists movements_type_check;
alter table movements add constraint movements_type_check
  check (type in ('ship','receive','forward','stage','pull','adjust'));

alter table items add column if not exists ship_final boolean not null default false;
