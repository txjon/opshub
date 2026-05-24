-- Pre-order workflow scaffolding.
--
-- Repurposes the existing fulfillment_projects table (mode='preorder') as
-- the pre-order entity, adding a structured status field. Pre-orders flow
-- through: planning → building → open → closed → producing → fulfilling
-- → complete. Each transition has an owner (Taylor / Abigail / Drake /
-- ShipStation) and OpsHub surfaces the right action per phase.
--
-- New `preorder_products` table holds Taylor's planned product list before
-- the Labs job is created. Each row = one item Abigail will build in
-- Shopify. Once Drake pushes to production (closing the pre-order),
-- these rows seed buy_sheet items on the linked Labs job.
--
-- The fulfillment_projects.source_job_id column (added by mig 051 for
-- legacy inventory backfill) is repurposed as the link to the Labs job
-- created at push-to-production.

alter table fulfillment_projects
  add column if not exists preorder_status text;

alter table fulfillment_projects
  drop constraint if exists fulfillment_projects_preorder_status_check;

alter table fulfillment_projects
  add constraint fulfillment_projects_preorder_status_check
  check (
    preorder_status is null
    or preorder_status in ('planning', 'building', 'open', 'closed', 'producing', 'fulfilling', 'complete')
  );

-- Pre-order product list — what Taylor scopes; what Abigail builds in
-- Shopify. Sizes stored as text[] so we don't lock to a specific size
-- vocabulary; retail price is per-product (uniform across sizes for v1).
-- mockup_drive_file_id references a file already uploaded via Art Studio.
create table if not exists preorder_products (
  id uuid primary key default gen_random_uuid(),
  preorder_id uuid not null references fulfillment_projects(id) on delete cascade,
  name text not null,
  blank_vendor text,
  blank_sku text,
  sizes text[] default '{}'::text[],
  retail_price numeric(10, 2),
  mockup_drive_file_id text,
  shopify_product_url text,
  sort_order int default 0,
  is_built_in_shopify boolean default false,
  built_in_shopify_at timestamptz,
  built_in_shopify_by uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz default now()
);

create index if not exists idx_preorder_products_preorder
  on preorder_products(preorder_id);

alter table preorder_products enable row level security;

drop policy if exists "Authenticated users can manage preorder_products" on preorder_products;
create policy "Authenticated users can manage preorder_products"
  on preorder_products for all to authenticated using (true) with check (true);

-- Backfill: any existing fulfillment_projects with mode='preorder' gets
-- preorder_status='planning' so they fall into the new workflow.
update fulfillment_projects
  set preorder_status = 'planning'
  where mode = 'preorder' and preorder_status is null;
