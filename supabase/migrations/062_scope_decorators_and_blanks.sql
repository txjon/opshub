-- Phase 4 — scope decorators and blank_catalog to a company.
--
-- Reframed May 5: companies do NOT share decorator/blank rows. Each
-- tenant has its own copy with its own pricing, contacts, addresses,
-- and supplier accounts. When IHM is seeded, we'll duplicate HPD's
-- rows into IHM via an explicit "copy" action — never a join.
--
-- Same pattern as the other scoped tables:
--   1. Add nullable company_id, FK to companies
--   2. Backfill all existing rows to HPD
--   3. Apply the default-to-HPD INSERT trigger so existing code keeps
--      writing to HPD without explicit company_id injection
--   4. Apply the RLS RESTRICTIVE policy so reads/writes are scoped to
--      the calling user's accessible companies
--   5. Flip column to NOT NULL (verifies no NULLs slipped through)

DO $$
DECLARE
  hpd_id uuid;
  null_count int;
  tbl text;
  scoped_tables text[] := ARRAY['decorators', 'blank_catalog'];
BEGIN
  SELECT id INTO hpd_id FROM companies WHERE slug = 'hpd';
  IF hpd_id IS NULL THEN
    RAISE EXCEPTION 'HPD company row missing — run mig 056 first';
  END IF;

  FOREACH tbl IN ARRAY scoped_tables LOOP
    -- 1. Add nullable column + FK
    EXECUTE format(
      'ALTER TABLE %I ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT',
      tbl
    );

    -- 2. Backfill to HPD
    EXECUTE format(
      'UPDATE %I SET company_id = $1 WHERE company_id IS NULL',
      tbl
    ) USING hpd_id;

    -- 3. Index for query speed
    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON %I(company_id)',
      'idx_' || tbl || '_company', tbl
    );

    -- 4. Apply the default-to-HPD INSERT trigger
    EXECUTE format('DROP TRIGGER IF EXISTS fill_company_id ON %I', tbl);
    EXECUTE format(
      'CREATE TRIGGER fill_company_id BEFORE INSERT ON %I
       FOR EACH ROW EXECUTE FUNCTION default_company_id_to_hpd()',
      tbl
    );

    -- 5. Apply the RLS restrictive scope policy
    EXECUTE format('DROP POLICY IF EXISTS company_scope_restrictive ON %I', tbl);
    EXECUTE format(
      'CREATE POLICY company_scope_restrictive ON %I AS RESTRICTIVE
       FOR ALL TO authenticated
       USING (company_id = ANY(public.current_user_company_ids()))
       WITH CHECK (company_id = ANY(public.current_user_company_ids()))',
      tbl
    );

    -- 6. Belt-and-suspenders NULL check + NOT NULL flip
    EXECUTE format('SELECT count(*) FROM %I WHERE company_id IS NULL', tbl) INTO null_count;
    IF null_count > 0 THEN
      RAISE EXCEPTION '% has % rows with NULL company_id', tbl, null_count;
    END IF;
    EXECUTE format('ALTER TABLE %I ALTER COLUMN company_id SET NOT NULL', tbl);
  END LOOP;
END $$;
