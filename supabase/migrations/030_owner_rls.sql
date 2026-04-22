-- Owner role full access across core tables
--
-- The 002_rls.sql policies predate the 'owner' role. Legacy policies
-- only recognize manager/sales/production/warehouse/shipping/readonly,
-- so queries under an owner-role session silently return empty when
-- embedded relations (e.g. clients(name) on art_briefs) are involved.
--
-- This adds owner-specific FOR ALL policies on the core tables. Safe to
-- rerun — CREATE POLICY IF NOT EXISTS isn't supported in PG, so we drop-first.

-- CLIENTS
DROP POLICY IF EXISTS "owner full access" ON clients;
CREATE POLICY "owner full access" ON clients FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- CONTACTS
DROP POLICY IF EXISTS "owner full access" ON contacts;
CREATE POLICY "owner full access" ON contacts FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- JOBS
DROP POLICY IF EXISTS "owner full access" ON jobs;
CREATE POLICY "owner full access" ON jobs FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- ITEMS
DROP POLICY IF EXISTS "owner full access" ON items;
CREATE POLICY "owner full access" ON items FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- BUY_SHEET_LINES
DROP POLICY IF EXISTS "owner full access" ON buy_sheet_lines;
CREATE POLICY "owner full access" ON buy_sheet_lines FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- JOB_CONTACTS
DROP POLICY IF EXISTS "owner full access" ON job_contacts;
CREATE POLICY "owner full access" ON job_contacts FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- DECORATORS
DROP POLICY IF EXISTS "owner full access" ON decorators;
CREATE POLICY "owner full access" ON decorators FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- DECORATOR_ASSIGNMENTS
DROP POLICY IF EXISTS "owner full access" ON decorator_assignments;
CREATE POLICY "owner full access" ON decorator_assignments FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- PAYMENT_RECORDS
DROP POLICY IF EXISTS "owner full access" ON payment_records;
CREATE POLICY "owner full access" ON payment_records FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- BLANK_CATALOG
DROP POLICY IF EXISTS "owner full access" ON blank_catalog;
CREATE POLICY "owner full access" ON blank_catalog FOR ALL
  USING (get_user_role() = 'owner') WITH CHECK (get_user_role() = 'owner');

-- Force PostgREST schema cache refresh
NOTIFY pgrst, 'reload schema';
