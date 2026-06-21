-- 093: per-vendor default shipping route. When a vendor ships our orders in
-- bulk to HPD (e.g. One Stop Merch, Sticker Mule), set this so their items
-- behave like ship-through even on a drop-ship job. Applied to an item (stamped
-- onto items.shipping_route) when a PO is sent to the vendor, but only when the
-- item has no manual route override — so manual picks always win. NULL = no
-- opinion (item falls back to the job's route).
alter table decorators
  add column if not exists default_shipping_route text;
