-- 160: order requests go brief-native (Phase 3). Lab-era columns relax —
-- a request now attaches to EITHER a lab thread (legacy sandbox) or a real
-- art brief; identity rides on the brief's client.
alter table lab_order_requests alter column thread_id drop not null;
alter table lab_order_requests alter column client_id drop not null;
