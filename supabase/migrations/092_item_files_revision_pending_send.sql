-- 092: flag a freshly-uploaded proof that REPLACED a revision_requested proof
-- and hasn't been re-sent to the client yet. Drives the "Revised — send to
-- client" nudge on the Approvals tab + command center. Cleared when the
-- "Send revised proofs" email fires.
alter table item_files
  add column if not exists revision_pending_send boolean not null default false;
