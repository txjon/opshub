-- The receive/forward pull UI (lib/handoff PULL_KINDS) offers "Damaged" as a pull
-- kind, but the pull_requests.kind CHECK constraint from migration 117 omitted it
-- ('sample','photo','catalog','client','event','other'). So a "damaged" pull's
-- pull_request insert was rejected → no held bucket created (it never reached the
-- Pulls tab), even though the ledger pull movement still landed. Align the
-- constraint with the UI's kind list.
alter table pull_requests drop constraint if exists pull_requests_kind_check;
alter table pull_requests add constraint pull_requests_kind_check
  check (kind in ('damaged','sample','photo','catalog','client','event','other'));
