-- 172: menu_leads — the email gate + unlisted menu experience (Sep 7 2026).
-- One row per person who knocked. status 'browsed' = entered email, looking
-- around (collapsed bucket in /intake); 'quote_requested' = asked for the
-- real quote (the actionable queue). picks autosaves as they browse; on
-- quote request we snapshot the exact rates they were shown into
-- rates_snapshot — menu_rates drifts after edits and the quoting
-- conversation must know what the customer saw, not what the table says
-- today. client_match links a gate email that matches an existing client
-- contact so staff never quote rack rates to a friend of the house.
create table if not exists menu_leads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id),
  token text not null unique,
  email text not null,
  status text not null default 'browsed',      -- browsed | quote_requested | responded | converted | declined
  picks jsonb not null default '{}'::jsonb,     -- {productGroup, styleCode, qty, budget, colorways, notes, ...}
  rates_snapshot jsonb,                         -- menu_rates rows as shown, captured at quote request
  contact jsonb,                                -- {name, phone, neededBy, notes} from the quote-request form
  client_match uuid references clients(id) on delete set null,
  quote_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists menu_leads_email_idx on menu_leads (email);
create index if not exists menu_leads_status_idx on menu_leads (status);

drop trigger if exists fill_company_id on menu_leads;
create trigger fill_company_id before insert on menu_leads
  for each row execute function default_company_id_to_hpd();

-- RLS: the public menu talks through server routes on the service key;
-- staff read/write from /intake as authenticated.
alter table menu_leads enable row level security;
drop policy if exists menu_leads_all on menu_leads;
create policy menu_leads_all on menu_leads
  for all to authenticated using (true) with check (true);

grant all on menu_leads to service_role;
grant select, insert, update, delete on menu_leads to authenticated;

notify pgrst, 'reload schema';
