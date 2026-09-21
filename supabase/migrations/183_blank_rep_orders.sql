-- 183: Blank orders emailed to a supplier rep (Sep 21 2026). Some blank
-- purchases go to a rep by email (S&S) instead of a credit-card checkout. The
-- email is drafted in OpsHub from the buy sheet and sent through the production
-- inbox; this records what was ordered that way so the Purchasing block can
-- show it per item, and remembers each supplier's rep so nobody retypes it.
create table if not exists blank_supplier_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  supplier text not null,                 -- matches items.blank_vendor ("S&S", "AS Colour", …)
  rep_name text,
  rep_email text not null,
  cc_emails text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (company_id, supplier)
);

create table if not exists blank_rep_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  job_id uuid not null references jobs(id) on delete cascade,
  supplier text not null,
  to_email text not null,
  cc_emails text[] not null default '{}',
  subject text not null,
  body text not null,                     -- exactly what was sent
  ship_to text,                           -- the ship-to block as sent
  items jsonb not null default '[]'::jsonb, -- [{item_id, name, letter, blank_vendor, blank_sku, color, qtys, total}]
  resend_message_id text,
  sent_by uuid,
  sent_at timestamptz not null default now()
);
create index if not exists idx_blank_rep_orders_job on blank_rep_orders(job_id);

do $$
declare tbl text;
begin
  foreach tbl in array array['blank_supplier_contacts', 'blank_rep_orders'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format('create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format('create trigger fill_company_id before insert on %I for each row execute function default_company_id_to_hpd()', tbl);
  end loop;
end $$;
notify pgrst, 'reload schema';
