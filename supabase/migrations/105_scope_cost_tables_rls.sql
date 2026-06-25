-- Scope the AP / cost-reconciliation tables to owner + manager.
--
-- Migrations 098/100 shipped these with `for all to authenticated using (true)`
-- — i.e. ANY logged-in user could read AND write the entire AP ledger (every
-- vendor bill, amount, PO ref), including warehouse/ops/staff contractors. That
-- was the fast-build default; on a multi-role team it's a financial-data hole.
--
-- Consumers verified before tightening:
--   • ReconciliationClient (browser/user session) — owner-nav, used by owner/manager.
--   • /api/qb/bill + /api/qb/bill/notify — use the service-role admin client
--     (bypasses RLS), so the QB push / remittance are unaffected.
--   • /god-mode — owner-only (email-gated), reads under the owner session.
-- No staff/ops/warehouse-facing surface reads these tables.
--
-- payment_records is already correctly scoped (manager/sales/owner) — untouched.
--
-- Access predicate: owner/manager role OR is_god (gods own both tenants and must
-- never be locked out — also a safety net since role rows can drift). Wrapped in
-- a STABLE helper so the three policies stay identical.

create or replace function can_manage_ap() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(get_user_role() in ('owner','manager'), false)
      or exists (select 1 from profiles where id = auth.uid() and is_god = true);
$$;

-- cost_entries
drop policy if exists "Authenticated manage cost_entries" on cost_entries;
drop policy if exists "owner/manager manage cost_entries" on cost_entries;
create policy "owner/manager manage cost_entries" on cost_entries
  for all to authenticated using (can_manage_ap()) with check (can_manage_ap());

-- ap_vendors
drop policy if exists "Authenticated manage ap_vendors" on ap_vendors;
drop policy if exists "owner/manager manage ap_vendors" on ap_vendors;
create policy "owner/manager manage ap_vendors" on ap_vendors
  for all to authenticated using (can_manage_ap()) with check (can_manage_ap());

-- cost_vendor_status
drop policy if exists "Authenticated manage cost_vendor_status" on cost_vendor_status;
drop policy if exists "owner/manager manage cost_vendor_status" on cost_vendor_status;
create policy "owner/manager manage cost_vendor_status" on cost_vendor_status
  for all to authenticated using (can_manage_ap()) with check (can_manage_ap());

-- Grants stay as-is (grant gates table access; RLS filters rows). service_role
-- keeps full access for the API routes; authenticated is filtered to 0 rows for
-- non-owner/manager by the policies above.
