-- 138 — PRE-OPSHUB HISTORY (Jul 22 2026). Six years of QB exports land here:
-- every sales line (client, item, sizes, price) + every vendor purchase line.
-- These tables are READ-ONLY reference — never mutated by live flows, never
-- joined into live tables. They feed the derived intelligence: actual size
-- curves per client, sell-price history per product family, blank-style
-- frequency, vendor cost bands (the quick-quote fuel).
-- Raw text is always kept alongside anything parsed from it.

create table if not exists history_sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  txn_date date,
  txn_type text,
  doc_num text,
  customer text,
  description text,            -- raw, untouched
  qty numeric,
  unit_price numeric,
  amount numeric,
  product_group text,          -- QB product/service grouping (Tee, Hoodie, …)
  -- parsed from description (null when the line predates the structured format)
  product_name text,
  blank_style text,
  color text,
  size_qtys jsonb,             -- {"S":7,"M":13,"L":3} when the line carries sizes
  source_file text,
  imported_at timestamptz not null default now()
);
create index if not exists idx_hist_sales_customer on history_sales(customer);
create index if not exists idx_hist_sales_group on history_sales(product_group);
create index if not exists idx_hist_sales_blank on history_sales(blank_style);

create table if not exists history_vendor_costs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  txn_date date,
  txn_type text,
  doc_num text,
  vendor text,
  description text,            -- raw; usually the product/job name, no qty
  qty numeric,
  rate numeric,
  amount numeric,
  source_file text,
  imported_at timestamptz not null default now()
);
create index if not exists idx_hist_costs_vendor on history_vendor_costs(vendor);

do $$
declare tbl text;
begin
  foreach tbl in array array['history_sales','history_vendor_costs'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format('create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format('create trigger fill_company_id before insert on %I
                    for each row execute function default_company_id_to_hpd()', tbl);
    execute format('drop policy if exists company_scope_restrictive on %I', tbl);
    execute format('create policy company_scope_restrictive on %I as restrictive
                    for all to authenticated
                    using (company_id = any(public.current_user_company_ids()))
                    with check (company_id = any(public.current_user_company_ids()))', tbl);
  end loop;
end $$;
