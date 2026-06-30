-- Phase 1.5: let the bookkeeper (a /billing-granted user) manage AP.
-- Extends can_manage_ap (migration 105) so a user with '/billing' in
-- profiles.page_access can read/write cost_entries / ap_vendors / cost_vendor_status
-- — i.e. enter + push bills and see per-line projections for inline variance.
--
-- The AGGREGATE variance / margin views stay owner-only at the PAGE level
-- (/reconciliation isn't granted to them, and /billing renders billingOnly which
-- hides the Variances tab), NOT at the data level — the bookkeeper legitimately
-- needs the bill rows + projections to do her job.
--
-- Safe to apply anytime: the new OR clause matches only users who already have
-- '/billing' granted (nobody until we seed Abigail), so it grants no one new on its own.
create or replace function can_manage_ap() returns boolean
  language sql stable security definer set search_path = public as $$
  select coalesce(get_user_role() in ('owner','manager'), false)
      or exists (select 1 from profiles where id = auth.uid() and is_god = true)
      or exists (select 1 from profiles where id = auth.uid() and '/billing' = any(page_access));
$$;
