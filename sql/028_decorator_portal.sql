-- 028_decorator_portal.sql
-- Populate decorator portal tokens for vendor-facing magic links

-- Backfill any decorators missing a token
UPDATE decorators
SET external_token = gen_random_uuid()::text
WHERE external_token IS NULL OR external_token = '';

-- Unique index for portal lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_decorators_external_token
ON decorators(external_token) WHERE external_token IS NOT NULL;

-- Default for new decorators
ALTER TABLE decorators ALTER COLUMN external_token SET DEFAULT gen_random_uuid()::text;
