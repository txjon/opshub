-- Client Hub Phase 1: data model foundation
-- Terminology decision: keep DB table names (art_briefs / art_brief_files / art_brief_messages)
-- for backward compat with 26 existing files that reference them. "Design" is a UI-only
-- term going forward. Future cleanup pass can rename tables once the new UI is solid.

-- ── 1. Extend art_briefs state enum ──
-- pending_prep: designer uploaded final, HPD hasn't prepped production file yet
-- production_ready: HPD has done file cleanup, separations, CMYK, Drive upload.
--                    Products can only spawn from briefs in this state.
ALTER TABLE art_briefs DROP CONSTRAINT IF EXISTS art_briefs_state_check;
ALTER TABLE art_briefs ADD CONSTRAINT art_briefs_state_check
  CHECK (state IN (
    'draft','sent','in_progress','wip_review','client_review','revisions',
    'final_approved','pending_prep','production_ready','delivered'
  ));

-- ── 2. Art briefs: source (client-dropped vs HPD-on-behalf) ──
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS source text DEFAULT 'hpd'
  CHECK (source IN ('hpd','client'));
CREATE INDEX IF NOT EXISTS art_briefs_source_idx ON art_briefs(source);

-- ── 3. Art brief files: extend kind for WIP → 1st Draft → Revision → Final ──
ALTER TABLE art_brief_files DROP CONSTRAINT IF EXISTS art_brief_files_kind_check;
ALTER TABLE art_brief_files ADD CONSTRAINT art_brief_files_kind_check
  CHECK (kind IN ('reference','wip','first_draft','revision','final','client_intake'));

-- ── 4. Items: design_id — link each item to its source design ──
-- Nullable: specialty items without a design (sourced-only, no graphic) are allowed.
ALTER TABLE items ADD COLUMN IF NOT EXISTS design_id uuid
  REFERENCES art_briefs(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS items_design_id_idx ON items(design_id);

-- ── 5. Items: specialty_stage (flexible custom sub-statuses) ──
-- Shape enforced in UI, not SQL, to preserve Jon's flexibility per item.
-- Typical shape: { current: "Locating Source", history: [{stage, at, by}] }
ALTER TABLE items ADD COLUMN IF NOT EXISTS specialty_stage jsonb DEFAULT '{}'::jsonb;

-- ── 6. Jobs: add 'specialty' to job_type enum ──
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_job_type_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_job_type_check
  CHECK (job_type IN ('corporate','brand','artist','tour','webstore','drop_ship','specialty'));

-- ── 7. Clients: portal_tier gate for the premium hub ──
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_tier text DEFAULT 'standard'
  CHECK (portal_tier IN ('standard','premium'));
CREATE INDEX IF NOT EXISTS clients_portal_tier_idx ON clients(portal_tier);
