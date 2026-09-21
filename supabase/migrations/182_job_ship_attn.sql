-- 182: per-project ATTN line on the ship-to (Sep 21 2026). Addresses come from
-- the client address book now (mig 180/181), so the per-job reference that used
-- to be typed into the free-text address ("ATTN: PO-21724", usually the client's
-- PO number) needs its own home. Printed as the last line of EVERY destination
-- address on that job: PO/RFQ, vendor portal, box snapshot, packing slip, invoice.
alter table jobs add column if not exists ship_attn text;
notify pgrst, 'reload schema';
