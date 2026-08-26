-- 164: Internal lines (Aug 25 2026). HPD Web / House Party Labs are internal
-- clients — jobs exist for production + POs but are NOT revenue and never
-- get paid. Flag lives on the CLIENT; a trigger stamps every job from its
-- client so no creation path (new-job form, reorder cart, release buys,
-- duplicate) can forget. pnlJobs excludes is_internal from every P&L/AR
-- rollup; the QB invoice push refuses internal jobs.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
ALTER TABLE jobs    ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

UPDATE clients SET is_internal = true WHERE name IN ('HPD Web', 'House Party Labs');
UPDATE jobs SET is_internal = true
WHERE client_id IN (SELECT id FROM clients WHERE is_internal);

CREATE OR REPLACE FUNCTION stamp_job_is_internal() RETURNS trigger AS $$
BEGIN
  IF NEW.client_id IS NOT NULL THEN
    SELECT COALESCE(c.is_internal, false) INTO NEW.is_internal
    FROM clients c WHERE c.id = NEW.client_id;
    NEW.is_internal := COALESCE(NEW.is_internal, false);
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_is_internal ON jobs;
CREATE TRIGGER trg_job_is_internal
BEFORE INSERT OR UPDATE OF client_id ON jobs
FOR EACH ROW EXECUTE FUNCTION stamp_job_is_internal();
