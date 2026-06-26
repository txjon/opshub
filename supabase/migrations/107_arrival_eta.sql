-- Internal warehouse-arrival ETA (the ASN — when a vendor's batch lands at HPD),
-- distinct from items.client_eta (client-facing delivery comms). Auto-computed
-- as (po ship date + the vendor's transit buffer, in business days); production
-- can override per item. Receiving consumes it as the incoming ASN.
alter table decorators add column if not exists transit_days int;        -- business-day buffer; null → global default (5)
alter table items add column if not exists expected_arrival date;          -- per-item override of the computed arrival ETA
