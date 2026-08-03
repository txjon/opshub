-- 155: contacts.doc_routing — per-contact document routing (Aug 3, Jon's
-- 3-category cut of the Jun-11 parked design): 'approvals' | 'invoices' |
-- 'shipping'. NULL or empty = ADMIN (receives everything) — the zero-config
-- default, so every existing contact behaves exactly as before until
-- deliberately narrowed. resolveRecipients() in lib/recipients.ts is the one
-- reader; category with nobody assigned falls back to admins.
alter table contacts add column if not exists doc_routing text[];
notify pgrst, 'reload schema';
