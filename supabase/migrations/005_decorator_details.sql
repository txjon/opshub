-- Decorator contact + address fields
alter table decorators add column if not exists short_code text;
alter table decorators add column if not exists phone text;
alter table decorators add column if not exists address text;
alter table decorators add column if not exists city text;
alter table decorators add column if not exists state text;
alter table decorators add column if not exists zip text;

-- Ship-from address (pickup) — if different from ship-to
alter table decorators add column if not exists ship_from_address text;
alter table decorators add column if not exists ship_from_city text;
alter table decorators add column if not exists ship_from_state text;
alter table decorators add column if not exists ship_from_zip text;

-- Pricing data: qty tiers, per-color prices, tag prices, finishing, setup fees, specialty
-- Stored as JSONB matching the PRINTERS structure in CostingTab
alter table decorators add column if not exists pricing_data jsonb default null;
