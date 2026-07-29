-- 149: retire items.expected_arrival + items.client_eta (data wipe).
--
-- Both fields predate the date chain (Date flow v2, locked 2026-07-15).
-- Receiving's arrival override lives on the BOX (shipments.expected_arrival);
-- the client ETA is always chain-derived. Nothing writes these item fields
-- anymore (production2 only nulls expected_arrival on a ship-date edit), but
-- fossil values were still shadowing live chain dates on the client portal
-- (FOG "F Hat" showed 9/23 off a stale 9/20 arrival while the real chain said
-- 8/16 — found 2026-07-28). Code fallbacks removed in the same change; this
-- wipe makes every remaining reader inert. Columns kept (dropping is a
-- separate, riskier cleanup); values are the hazard, not the columns.
update items
set expected_arrival = null, client_eta = null
where expected_arrival is not null or client_eta is not null;
