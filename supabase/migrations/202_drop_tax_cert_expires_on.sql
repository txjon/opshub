-- 202: resale certificates carry an ISSUE date (mig 201, issued_on). The
-- expires_on column is no longer read or written anywhere (deployed Oct 13 2026).
alter table public.client_tax_certificates drop column if exists expires_on;
