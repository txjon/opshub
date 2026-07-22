-- 143: persist the warehouse notification (Jon, Jul 22 — "✓ Notified" was
-- session-local; the shipped board couldn't show what's been shared in a scan)
alter table shipments add column if not exists warehouse_notified_at timestamptz;
alter table shipments add column if not exists warehouse_notified_to text;
