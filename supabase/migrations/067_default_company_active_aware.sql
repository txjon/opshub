-- Make the default-company INSERT trigger aware of the active subdomain.
--
-- Before: default_company_id_to_hpd() always set company_id to HPD when
-- null. Combined with mig 064's RLS narrowing (which restricts gods to
-- the active company on each subdomain), this broke client/contact/etc.
-- inserts on app.inhousemerchandise.com — the trigger stamped HPD onto
-- new rows, then RLS WITH CHECK rejected them because HPD isn't in the
-- caller's narrowed list.
--
-- After: the trigger reads x-company-slug from request.headers (set by
-- lib/supabase/server.ts + lib/supabase/client.ts) and defaults to
-- THAT company. Falls back to HPD only when no header is present
-- (cron jobs, scripts, etc.). Same pattern as current_user_company_ids().
--
-- Renamed for clarity but the trigger references stay (we just CREATE
-- OR REPLACE the function body — function name unchanged).

CREATE OR REPLACE FUNCTION default_company_id_to_hpd()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  active_slug text;
BEGIN
  IF NEW.company_id IS NULL THEN
    BEGIN
      active_slug := nullif(current_setting('request.headers', true)::jsonb->>'x-company-slug', '');
    EXCEPTION WHEN OTHERS THEN
      active_slug := NULL;
    END;
    IF active_slug IS NOT NULL THEN
      SELECT id INTO NEW.company_id FROM companies
        WHERE slug = active_slug AND is_active = true;
    END IF;
    -- Fall back to HPD if header was missing or didn't match a row.
    IF NEW.company_id IS NULL THEN
      SELECT id INTO NEW.company_id FROM companies WHERE slug = 'hpd';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- generate_job_number() has its own inline default (mig 058) — apply
-- the same active-aware logic there so jobs created on IHM get IHM-
-- prefixed job numbers.
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  prefix text;
  yymm text;
  next_seq int;
  active_slug text;
BEGIN
  IF NEW.job_number IS NOT NULL AND NEW.job_number != '' THEN
    RETURN NEW;
  END IF;
  IF NEW.company_id IS NULL THEN
    BEGIN
      active_slug := nullif(current_setting('request.headers', true)::jsonb->>'x-company-slug', '');
    EXCEPTION WHEN OTHERS THEN
      active_slug := NULL;
    END;
    IF active_slug IS NOT NULL THEN
      SELECT id INTO NEW.company_id FROM companies WHERE slug = active_slug AND is_active = true;
    END IF;
    IF NEW.company_id IS NULL THEN
      SELECT id INTO NEW.company_id FROM companies WHERE slug = 'hpd';
    END IF;
  END IF;
  SELECT job_number_prefix INTO prefix FROM companies WHERE id = NEW.company_id;
  IF prefix IS NULL THEN prefix := 'JOB'; END IF;
  yymm := to_char(now(), 'YYMM');
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
