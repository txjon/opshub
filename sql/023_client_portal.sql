-- 023_client_portal.sql
-- Client portal: magic link access per project (no login required)

-- Add portal token to jobs — auto-generated UUID per project
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS portal_token UUID DEFAULT gen_random_uuid();

-- Backfill existing jobs
UPDATE jobs SET portal_token = gen_random_uuid() WHERE portal_token IS NULL;

-- Unique index for fast lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_portal_token ON jobs(portal_token);
