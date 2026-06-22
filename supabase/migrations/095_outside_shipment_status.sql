-- 095: outside_shipments lifecycle status. Separates the post-receive ROUTE
-- (ship_through | stage) from the workflow STATE, so every logged package goes
-- through receiving (pending → received) before splitting to shipping (forward)
-- or fulfillment (stage), then to done. Replaces the old overloaded
-- route/resolved model where route doubled as terminal state and Shipping/
-- Fulfillment destinations skipped receiving entirely.
alter table outside_shipments
  add column if not exists status text not null default 'pending';
  -- status: 'pending' (awaiting receive) | 'received' (split to onward page) | 'done'

-- Outbound tracking captured when a forwarded (ship_through) package is shipped
-- on to the client — distinct from the inbound carrier `tracking`.
alter table outside_shipments
  add column if not exists ship_tracking text;

-- Backfill from the old route/resolved model:
update outside_shipments set status = case
  when resolved = false then 'pending'
  when route in ('shipped', 'fulfilled') then 'done'
  when route is null or route = 'receiving' then 'done'   -- legacy received-only records
  else 'received'                                          -- ship_through / stage that were resolved
end
where status = 'pending';   -- only the freshly-defaulted rows

-- Normalize route to the two intents (ship_through | stage); terminal/legacy
-- values collapse back to an intent.
update outside_shipments set route = 'ship_through' where route = 'shipped';
update outside_shipments set route = 'stage' where route in ('fulfilled', 'receiving') or route is null;
