-- 096: attach outside shipments to a CLIENT rather than a job. Outside packages
-- (returns, supplies, drop-offs, bulk-vendor boxes) are client-level, not tied
-- to a specific project — the client gives us the forward-to address + contacts.
alter table outside_shipments
  add column if not exists client_id uuid references clients(id) on delete set null;

create index if not exists idx_outside_shipments_client on outside_shipments(client_id);
