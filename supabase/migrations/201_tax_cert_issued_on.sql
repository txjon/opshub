-- 201: a resale certificate's date is its ISSUE date (Jon, Oct 13 2026 —
-- NV permits don't expire; the "expires" field kept catching issue dates and
-- blocking approval). Additive: issued_on gets every existing value; the old
-- expires_on column is dropped by mig 202 once the code reading it is gone.
alter table public.client_tax_certificates add column if not exists issued_on date;
update public.client_tax_certificates set issued_on = expires_on where issued_on is null and expires_on is not null;
