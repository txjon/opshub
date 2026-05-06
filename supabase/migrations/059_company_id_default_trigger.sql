-- Phase 2 — DB-level safety net so existing code paths keep writing
-- to the right tenant without 37+ explicit code edits. Each scoped
-- table gets a BEFORE INSERT trigger that fills company_id with HPD
-- when the row is inserted without one.
--
-- This is a stopgap: when IHM data starts flowing (Phase 6), we'll
-- swap the trigger function for one that reads the active tenant
-- from a request-scoped session variable. For now, HPD is the only
-- tenant with data, so defaulting to HPD is correct.
--
-- jobs is excluded because generate_job_number() already does this
-- inline (see mig 058).

CREATE OR REPLACE FUNCTION default_company_id_to_hpd()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id FROM companies WHERE slug = 'hpd';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
  scoped_tables text[] := ARRAY[
    'clients', 'contacts', 'items', 'payment_records',
    'art_briefs', 'fulfillment_projects',
    'qb_tokens', 'shipstation_reports', 'shipstation_sku_costs',
    'designers', 'outside_shipments',
    'messages', 'notifications',
    'client_proposal_items', 'client_releases', 'client_files'
  ];
BEGIN
  FOREACH tbl IN ARRAY scoped_tables LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS fill_company_id ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER fill_company_id BEFORE INSERT ON %I
       FOR EACH ROW EXECUTE FUNCTION default_company_id_to_hpd()',
      tbl
    );
  END LOOP;
END $$;
