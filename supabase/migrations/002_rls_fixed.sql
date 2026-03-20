-- Row Level Security Policies
-- Run AFTER 001_initial_schema.sql

create or replace function get_user_role()
returns text as $$
  select role from profiles where id = auth.uid();
$$ language sql security definer stable;

create or replace function get_user_client_ids()
returns uuid[] as $$
  select assigned_client_ids from profiles where id = auth.uid();
$$ language sql security definer stable;

-- Enable RLS
alter table clients enable row level security;
alter table contacts enable row level security;
alter table jobs enable row level security;
alter table job_contacts enable row level security;
alter table items enable row level security;
alter table buy_sheet_lines enable row level security;
alter table decorators enable row level security;
alter table decorator_assignments enable row level security;
alter table shipments enable row level security;
alter table shipment_items enable row level security;
alter table payment_records enable row level security;
alter table inventory_records enable row level security;
alter table profiles enable row level security;
alter table alerts enable row level security;
alter table audit_log enable row level security;
alter table job_templates enable row level security;

-- PROFILES
create policy "users read own profile" on profiles for select using (id = auth.uid());
create policy "managers read all profiles" on profiles for select using (get_user_role() = 'manager');
create policy "users update own profile" on profiles for update using (id = auth.uid());

-- CLIENTS
create policy "managers and sales full access clients" on clients for all using (get_user_role() in ('manager','sales'));
create policy "others read clients" on clients for select using (get_user_role() in ('production','warehouse','shipping','readonly'));

-- CONTACTS
create policy "managers and sales full access contacts" on contacts for all using (get_user_role() in ('manager','sales'));
create policy "others read contacts" on contacts for select using (get_user_role() in ('production','warehouse','shipping','readonly'));

-- JOBS
create policy "managers all jobs" on jobs for all using (get_user_role() = 'manager');
create policy "production sees production jobs" on jobs for select using (get_user_role() = 'production' and phase in ('pre_production','production'));
create policy "warehouse sees receiving jobs" on jobs for select using (get_user_role() = 'warehouse' and phase in ('production','receiving'));
create policy "shipping sees shipping jobs" on jobs for select using (get_user_role() = 'shipping' and phase in ('receiving','shipping'));
create policy "sales sees their client jobs" on jobs for all using (get_user_role() = 'sales' and client_id = any(get_user_client_ids()));
create policy "readonly sees all jobs" on jobs for select using (get_user_role() = 'readonly');

-- ITEMS
create policy "authenticated read items" on items for select using (auth.uid() is not null);
create policy "managers production sales edit items" on items for all using (get_user_role() in ('manager','production','sales'));

-- BUY SHEET LINES
create policy "authenticated read buy sheet" on buy_sheet_lines for select using (auth.uid() is not null);
create policy "warehouse managers edit buy sheet" on buy_sheet_lines for all using (get_user_role() in ('manager','warehouse','production'));

-- DECORATORS
create policy "authenticated read decorators" on decorators for select using (auth.uid() is not null);
create policy "managers production manage decorators" on decorators for all using (get_user_role() in ('manager','production'));

-- DECORATOR ASSIGNMENTS
create policy "authenticated read assignments" on decorator_assignments for select using (auth.uid() is not null);
create policy "managers production edit assignments" on decorator_assignments for all using (get_user_role() in ('manager','production'));

-- SHIPMENTS
create policy "authenticated read shipments" on shipments for select using (auth.uid() is not null);
create policy "shipping managers manage shipments" on shipments for all using (get_user_role() in ('manager','shipping','warehouse'));

-- PAYMENT RECORDS
create policy "managers sales read payments" on payment_records for select using (get_user_role() in ('manager','sales'));
create policy "managers manage payments" on payment_records for all using (get_user_role() = 'manager');

-- ALERTS
create policy "users see role alerts" on alerts for select using (get_user_role() = any(assigned_roles) or get_user_role() = 'manager');
create policy "managers manage alerts" on alerts for all using (get_user_role() = 'manager');
create policy "users dismiss alerts" on alerts for update using (get_user_role() = any(assigned_roles));

-- JOB TEMPLATES
create policy "managers sales manage templates" on job_templates for all using (get_user_role() in ('manager','sales'));
create policy "others read templates" on job_templates for select using (get_user_role() in ('production','warehouse','shipping'));

-- AUDIT LOG
create policy "managers read audit log" on audit_log for select using (get_user_role() = 'manager');
create policy "authenticated write audit log" on audit_log for insert with check (auth.uid() is not null);

-- JOB CONTACTS
create policy "authenticated read job contacts" on job_contacts for select using (auth.uid() is not null);
create policy "managers sales manage job contacts" on job_contacts for all using (get_user_role() in ('manager','sales'));

-- SHIPMENT ITEMS
create policy "authenticated read shipment items" on shipment_items for select using (auth.uid() is not null);
create policy "managers shipping manage shipment items" on shipment_items for all using (get_user_role() in ('manager','shipping','warehouse'));

-- INVENTORY
create policy "authenticated read inventory" on inventory_records for select using (auth.uid() is not null);
create policy "managers warehouse manage inventory" on inventory_records for all using (get_user_role() in ('manager','warehouse'));
