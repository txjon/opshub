-- 097: per-item outbound (HPD → client) forward state for ship-through items.
-- Separates the OUTBOUND forward from the inbound decorator-ship + receive, so a
-- multi-vendor ship-through job can be forwarded to the client in WAVES (ship
-- what's landed, leave the rest "awaiting") instead of all-or-nothing on the
-- job-level fulfillment_status. forward_tracking groups items shipped together.
alter table items
  add column if not exists forwarded_at timestamptz,
  add column if not exists forward_tracking text;

create index if not exists idx_items_forward_tracking on items(forward_tracking);
