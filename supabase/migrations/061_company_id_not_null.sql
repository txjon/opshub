-- Phase 3 — flip company_id to NOT NULL on every scoped table.
--
-- Safe to apply now that:
--   1. Every existing row has been backfilled to HPD (mig 058).
--   2. The default-to-HPD INSERT trigger guarantees no future row can
--      land without a company_id (mig 058 inline for jobs, mig 059 for
--      everything else).
--   3. RLS restrictive policies enforce that company_id matches the
--      caller's accessible companies (mig 060), so even bypassing the
--      trigger via raw SQL still requires a valid company_id.
--
-- Belt-and-suspenders: the safety check inside the loop verifies no
-- NULL rows exist before flipping. If one slipped through somehow,
-- the migration aborts loudly rather than silently leaving NOT NULL
-- unenforced.

DO $$
DECLARE
  tbl text;
  null_count int;
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
    EXECUTE format('SELECT count(*) FROM %I WHERE company_id IS NULL', tbl) INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION '% has % rows with NULL company_id — backfill before flipping NOT NULL', tbl, null_count;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', tbl);
  END LOOP;
END $$;
