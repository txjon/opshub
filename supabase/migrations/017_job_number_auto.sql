-- Auto-generate job numbers: HPD-YYMM-NNN
CREATE OR REPLACE FUNCTION generate_job_number()
RETURNS TRIGGER AS $$
DECLARE
  prefix text;
  seq int;
BEGIN
  IF NEW.job_number IS NULL OR NEW.job_number = '' THEN
    prefix := 'HPD-' || to_char(NOW(), 'YYMM');
    SELECT COALESCE(MAX(
      CAST(NULLIF(SUBSTRING(job_number FROM '-(\d+)$'), '') AS int)
    ), 0) + 1
    INTO seq
    FROM jobs
    WHERE job_number LIKE prefix || '-%';
    NEW.job_number := prefix || '-' || LPAD(seq::text, 3, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_job_number ON jobs;
CREATE TRIGGER trg_job_number
  BEFORE INSERT ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION generate_job_number();

-- Backfill existing jobs without numbers
DO $$
DECLARE
  r RECORD;
  prefix text;
  seq int;
BEGIN
  FOR r IN SELECT id, created_at FROM jobs WHERE job_number IS NULL OR job_number = '' ORDER BY created_at LOOP
    prefix := 'HPD-' || to_char(r.created_at, 'YYMM');
    SELECT COALESCE(MAX(
      CAST(NULLIF(SUBSTRING(job_number FROM '-(\d+)$'), '') AS int)
    ), 0) + 1
    INTO seq
    FROM jobs
    WHERE job_number LIKE prefix || '-%';
    UPDATE jobs SET job_number = prefix || '-' || LPAD(seq::text, 3, '0') WHERE id = r.id;
  END LOOP;
END $$;
