-- "Ready for pickup" flag for items from local pickup vendors (Stoked, Teeland
-- Screen, Teeland Embroidery, Elevate, ...). Replaces typing "pick up" into the
-- tracking field — that magic string mis-grouped the receiving board (every
-- vendor+"PICK-UP" item collapsed into one block across jobs). Set on Mark
-- Shipped (auto-checked when the vendor's PO ship method is "Pick Up"); receiving
-- groups pickup_ready items into one per-vendor block.
alter table items add column if not exists pickup_ready boolean not null default false;
