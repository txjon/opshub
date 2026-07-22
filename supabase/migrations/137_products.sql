-- 137 — PRODUCTS: the first-class pre-job object (Jul 22 2026).
--
-- Doctrine (Jon): "The studio is the place for everything before a job is
-- created… products are assigned to a job when ready." A PRODUCT lives on the
-- CLIENT forever (design + format + retail + notes); an ITEM is one
-- production run of it inside one job. items.job_id stays NOT NULL — this
-- table is what "exists before the job," never jobless items.
--
-- Birth moment: the client-approval fork in the hub Studio ("Order now" /
-- "Bring it back later") — both doors birth one product per build-out line
-- (unique brief_id+line_id makes birth idempotent). parent_product_id is the
-- flip lineage (different blank/ink colorway = child product), in the schema
-- from day one so no family tree ever needs guessing later.

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid not null references clients(id) on delete cascade,
  brief_id uuid references art_briefs(id) on delete set null,   -- the idea it was born from
  line_id text,                        -- product_spec.products[].id it was promoted from
  parent_product_id uuid references products(id) on delete set null,  -- flip lineage
  title text not null,                 -- "{idea title} {format}"
  format text,
  retail numeric,                      -- client's number; quoting stays per-run
  model text check (model in ('preorder','stock','not_sure')),
  notes text,
  spec jsonb not null default '{}',    -- room to grow: blank, colors, size curve
  state text not null default 'ready' check (state in ('ready','retired')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (brief_id, line_id)
);
create index if not exists idx_products_client on products(client_id);
create index if not exists idx_products_brief on products(brief_id);

-- Each production run points home. design_id (brief) stays for legacy reads.
alter table items add column if not exists product_id uuid references products(id) on delete set null;

-- RLS: house pattern (team-all + restrictive company scope + fill trigger)
do $$
begin
  execute 'alter table products enable row level security';
  execute 'drop policy if exists "team all" on products';
  execute 'create policy "team all" on products for all to authenticated using (true) with check (true)';
  execute 'grant all on table products to authenticated, service_role';
  execute 'drop trigger if exists fill_company_id on products';
  execute 'create trigger fill_company_id before insert on products
           for each row execute function default_company_id_to_hpd()';
  execute 'drop policy if exists company_scope_restrictive on products';
  execute 'create policy company_scope_restrictive on products as restrictive
           for all to authenticated
           using (company_id = any(public.current_user_company_ids()))
           with check (company_id = any(public.current_user_company_ids()))';
end $$;
