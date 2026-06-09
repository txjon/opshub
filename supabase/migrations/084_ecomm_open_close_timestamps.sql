-- 084: pre-order open/close become timestamps (were `date`, mig 052).
--
-- The window has a real time (e.g. 6/14 9:00a PT) and that time must live
-- in OpsHub so the whole team sees it in one place, not only in Shopify.
-- Single-timezone business (Pacific): the UI treats these as wall-clock —
-- input + display slice the YYYY-MM-DDTHH:mm portion so no timezone
-- conversion can shift the hour. Stored as timestamptz.
--
-- target_ship_date stays a plain `date` — a delivery target needs no time.
--
-- Safe cast: existing date values become midnight timestamps via ::timestamptz.
ALTER TABLE fulfillment_projects
  ALTER COLUMN open_date  TYPE timestamptz USING open_date::timestamptz,
  ALTER COLUMN close_date TYPE timestamptz USING close_date::timestamptz;
