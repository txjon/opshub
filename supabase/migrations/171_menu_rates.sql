-- 171: menu_rates — the pricing table behind the brand-led intake menu
-- (Sep 6 2026 design session). One row per style × qty band. A seed script
-- (scripts/seed-menu-rates.ts) proposes seeded_lo/seeded_hi from job
-- history + live items; price_lo/price_hi are what the menu shows and are
-- Jon-editable — once edited_at is set, the seed script refreshes only the
-- seeded_* columns and never touches the live prices.
create table if not exists menu_rates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  product_group text not null,            -- 'tee' | 'hoodie'
  lane text not null,                     -- 'la_apparel' | 'as_colour' | 'popular'
  style_code text not null,               -- '1801GD', '5001', 'NL6210', 'HF-09', ...
  style_name text not null,               -- display: 'LA Apparel 1801GD'
  band_min int not null,                  -- 48 / 100 / 250 / 500
  price_lo numeric,
  price_hi numeric,
  seeded_lo numeric,
  seeded_hi numeric,
  seed_meta jsonb not null default '{}'::jsonb,  -- {lines, units, source, cost_basis, flagged}
  edited_at timestamptz,
  edited_by text,
  active boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, style_code, band_min)
);

drop trigger if exists fill_company_id on menu_rates;
create trigger fill_company_id before insert on menu_rates
  for each row execute function default_company_id_to_hpd();

-- RLS: team reads/writes via dashboard grid; the public menu page reads
-- through a server route on the service key (no anon grant on purpose).
alter table menu_rates enable row level security;
drop policy if exists menu_rates_all on menu_rates;
create policy menu_rates_all on menu_rates
  for all to authenticated using (true) with check (true);

-- Explicit Data API grants (Supabase default change, enforced Oct 30 2026).
grant all on menu_rates to service_role;
grant select, insert, update, delete on menu_rates to authenticated;

notify pgrst, 'reload schema';
