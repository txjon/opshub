-- 136: receiving count variance resolution (The Distro, Jul 21 2026).
-- A variance card (sum(ship_qtys) != sum(received_qtys)) can be dismissed as
-- "resolved" once a human has settled it (recounted, vendor answered, PO
-- reconciled). The resolution snapshots the counts it resolved:
--   { at, by, note, ship_total, recv_total }
-- Readers treat it as resolved ONLY while the snapshot totals still match the
-- live counts — any later correction invalidates it and the card resurfaces.
-- Self-invalidating by design: no hooks needed in the ledger bridge.
alter table items add column if not exists variance_resolved jsonb;
