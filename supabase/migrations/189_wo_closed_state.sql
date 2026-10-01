-- 189: work orders can CLOSE as "received outside" (Jon, Sep 30). Five stale
-- Sike Ops creative orders sat LATE on the desk because the art came back
-- through Slack/email and OpsHub never saw a delivery. Pull reads as killed
-- and Accept needs a portal delivery; neither tells the truth. 'closed' =
-- done, handled outside — off the desk, not a kill, no file to lock.
alter table design_work_orders drop constraint if exists design_work_orders_state_check;
alter table design_work_orders add constraint design_work_orders_state_check
  check (state in ('out','delivered','in_revision','accepted','killed','closed'));
