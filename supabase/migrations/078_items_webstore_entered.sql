-- Stage-route handoff to Shopify: separate event from "received at HPD."
--
-- Workflow for stage jobs:
--   1. Decorator ships items → received at HPD (items.received_at_hpd)
--   2. Warehouse team enters inventory into Shopify
--   3. Shopify hands off to ShipStation for fulfillment
--
-- OpsHub tracks step 1 and step 2; ShipStation owns step 3. Without
-- this column, stage jobs got stuck "at HPD" forever because there
-- was no signal for "ready to leave OpsHub's hands." Stage phase
-- recalc now requires both received_at_hpd AND webstore_entered_at
-- before flipping to complete.
--
-- Ship-through and drop-ship don't use this column — their handoff
-- events are fulfillment_status="shipped" (ship-through) or
-- shippedFromDecorator (drop-ship).

alter table items
  add column if not exists webstore_entered_at timestamptz,
  add column if not exists webstore_entered_by uuid references auth.users(id) on delete set null;

-- Index so the receive page can query "received but not yet entered"
-- without a full scan once volume builds up.
create index if not exists idx_items_webstore_entered_at
  on items(webstore_entered_at)
  where webstore_entered_at is null;
