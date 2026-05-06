-- Per-company department list. Each tenant only renders the
-- departments they actually run. HPD has the full set (labs, distro,
-- ecomm, contacts, settings); IHM at launch only runs Labs (production
-- workflow) — no warehouse, no ecomm storefronts. Layout intersects
-- this with the user's role-based access to render the sidebar.

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS departments text[] NOT NULL DEFAULT ARRAY['labs','distro','ecomm','contacts','settings']::text[];

UPDATE companies
SET departments = ARRAY['labs','contacts','settings']::text[]
WHERE slug = 'ihm';
