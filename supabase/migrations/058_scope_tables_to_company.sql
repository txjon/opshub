-- Phase 1c — scope every top-level tenant-bearing table to a company.
-- Each scoped table gets:
--   1. nullable company_id column added (idempotent)
--   2. backfilled to HPD for every existing row
--   3. indexed for query speed
--   4. FK to companies(id) ON DELETE RESTRICT (can't delete a company
--      while it has data — has to be archived, not deleted)
--
-- Columns stay NULLABLE in this migration. Once application code is
-- updated to inject company_id on every INSERT (Phase 2), a follow-up
-- migration flips them to NOT NULL. This keeps existing code working
-- while the column lands.
--
-- Not scoped here (transitive — looked up via parent in app code +
-- future RLS subqueries): buy_sheet_lines, job_contacts, job_activity,
-- decorator_assignments, art_brief_files, art_brief_comments,
-- art_brief_messages, item_files, fulfillment_inventory,
-- fulfillment_daily_logs, release_items, item_store_listings,
-- staging_item_messages.
--
-- Not scoped at all (shared identity across tenants — pricing/account
-- divergence handled in Phase 2 link tables): decorators, blank_catalog.
--
-- IMPORTANT: this migration assumes the HPD seed row in companies
-- already exists (created by mig 056). Re-running is safe due to the
-- IF NOT EXISTS guards and idempotent backfill (UPDATE ... WHERE
-- company_id IS NULL).

DO $$
DECLARE
  hpd_id uuid;
BEGIN
  SELECT id INTO hpd_id FROM companies WHERE slug = 'hpd';
  IF hpd_id IS NULL THEN
    RAISE EXCEPTION 'HPD company row missing — run mig 056 first';
  END IF;

  -- ── jobs ──────────────────────────────────────────────────────
  ALTER TABLE jobs ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE jobs SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company_id);

  -- ── clients ───────────────────────────────────────────────────
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE clients SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company_id);

  -- ── contacts ──────────────────────────────────────────────────
  ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE contacts SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_contacts_company ON contacts(company_id);

  -- ── items ─────────────────────────────────────────────────────
  ALTER TABLE items ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE items SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_items_company ON items(company_id);

  -- ── payment_records ───────────────────────────────────────────
  ALTER TABLE payment_records ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE payment_records SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_payment_records_company ON payment_records(company_id);

  -- ── art_briefs ────────────────────────────────────────────────
  ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE art_briefs SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_art_briefs_company ON art_briefs(company_id);

  -- ── fulfillment_projects ──────────────────────────────────────
  ALTER TABLE fulfillment_projects ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE fulfillment_projects SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_fulfillment_projects_company ON fulfillment_projects(company_id);

  -- ── client_proposal_items ─────────────────────────────────────
  ALTER TABLE client_proposal_items ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE client_proposal_items SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_client_proposal_items_company ON client_proposal_items(company_id);

  -- ── client_releases ───────────────────────────────────────────
  ALTER TABLE client_releases ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE client_releases SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_client_releases_company ON client_releases(company_id);

  -- ── client_files ──────────────────────────────────────────────
  ALTER TABLE client_files ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE client_files SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_client_files_company ON client_files(company_id);

  -- ── outside_shipments ─────────────────────────────────────────
  ALTER TABLE outside_shipments ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE outside_shipments SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_outside_shipments_company ON outside_shipments(company_id);

  -- ── messages (party line) ─────────────────────────────────────
  ALTER TABLE messages ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE messages SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_messages_company ON messages(company_id);

  -- ── notifications ─────────────────────────────────────────────
  ALTER TABLE notifications ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE notifications SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_notifications_company ON notifications(company_id);

  -- ── designers ─────────────────────────────────────────────────
  ALTER TABLE designers ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE designers SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_designers_company ON designers(company_id);

  -- ── shipstation_reports ───────────────────────────────────────
  ALTER TABLE shipstation_reports ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE shipstation_reports SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_shipstation_reports_company ON shipstation_reports(company_id);

  -- ── shipstation_sku_costs ─────────────────────────────────────
  ALTER TABLE shipstation_sku_costs ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE shipstation_sku_costs SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_shipstation_sku_costs_company ON shipstation_sku_costs(company_id);

  -- ── qb_tokens ─────────────────────────────────────────────────
  -- One row per company. Existing single row maps to HPD.
  ALTER TABLE qb_tokens ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES companies(id) ON DELETE RESTRICT;
  UPDATE qb_tokens SET company_id = hpd_id WHERE company_id IS NULL;
  CREATE INDEX IF NOT EXISTS idx_qb_tokens_company ON qb_tokens(company_id);
  -- Enforce one QB connection per company (was implicit single-row before).
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_qb_tokens_company ON qb_tokens(company_id);
END $$;

-- Update job_number generator to use the company's prefix from the
-- companies table. The old trigger hardcoded "HPD-"; the new one looks
-- up jobs.company_id → companies.job_number_prefix. Existing rows are
-- untouched (they keep their old HPD-YYMM-NNN format).
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  yymm text;
  next_seq int;
BEGIN
  IF NEW.job_number IS NOT NULL AND NEW.job_number != '' THEN
    RETURN NEW;
  END IF;
  -- Default unset company_id to HPD until app code is updated to
  -- inject it. Keeps existing INSERTs working without breakage.
  IF NEW.company_id IS NULL THEN
    SELECT id INTO NEW.company_id FROM companies WHERE slug = 'hpd';
  END IF;
  SELECT job_number_prefix INTO prefix FROM companies WHERE id = NEW.company_id;
  IF prefix IS NULL THEN prefix := 'JOB'; END IF;
  yymm := to_char(now(), 'YYMM');
  -- Per-company, per-month sequence so HPD-2605-001 and IHM-2605-001
  -- live independently.
  SELECT COALESCE(MAX(
    CASE WHEN job_number ~ ('^' || prefix || '-' || yymm || '-(\d+)$')
    THEN substring(job_number FROM ('^' || prefix || '-' || yymm || '-(\d+)$'))::int
    ELSE 0 END
  ), 0) + 1
  INTO next_seq
  FROM jobs
  WHERE company_id = NEW.company_id
    AND job_number LIKE prefix || '-' || yymm || '-%';
  NEW.job_number := prefix || '-' || yymm || '-' || lpad(next_seq::text, 3, '0');
  RETURN NEW;
END;
$$;
