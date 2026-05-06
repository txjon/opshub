-- Phase 3 — DB-enforced tenant boundary on every scoped table.
-- Adds a RESTRICTIVE policy so a request can only read/write rows
-- whose company_id belongs to one of the calling user's active
-- memberships. Gods (profiles.is_god = true) get every active
-- company in their list via current_user_company_ids(), so they
-- still see everything.
--
-- RESTRICTIVE means it ANDs with existing permissive policies (the
-- "all authenticated" ones), so we don't have to drop or modify any
-- existing access logic. The new constraint stacks on top: still
-- need a permissive policy to allow the operation, AND the company
-- match restrictive policy must pass.
--
-- For the current HPD-only world: every row has company_id = HPD,
-- every user has HPD in their list → behavior unchanged. When IHM
-- data is seeded, IHM users only see IHM rows automatically.

DO $$
DECLARE
  tbl text;
  scoped_tables text[] := ARRAY[
    'jobs', 'clients', 'contacts', 'items', 'payment_records',
    'art_briefs', 'fulfillment_projects',
    'qb_tokens', 'shipstation_reports', 'shipstation_sku_costs',
    'designers', 'outside_shipments',
    'messages', 'notifications',
    'client_proposal_items', 'client_releases', 'client_files'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format('DROP POLICY IF EXISTS company_scope_restrictive ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY company_scope_restrictive ON %I AS RESTRICTIVE
       FOR ALL TO authenticated
       USING (company_id = ANY(public.current_user_company_ids()))
       WITH CHECK (company_id = ANY(public.current_user_company_ids()))',
      tbl
    );
  END LOOP;
END $$;
