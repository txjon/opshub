-- ── Per-image chat comments ──
-- Replaces the single-annotation-per-role-per-file model with a real
-- chat thread. Each file (REF, WIP, draft, revision, final) can carry
-- N comments from any of the three parties (HPD / Designer / Client),
-- ordered by created_at, visible to everyone.
--
-- Old columns (hpd_annotation / designer_annotation / client_annotation
-- on art_brief_files) are kept as-is for now — they're consumed by the
-- legacy art-studio hero pattern until that page is migrated. New
-- portal surfaces read from this table.

CREATE TABLE IF NOT EXISTS art_brief_file_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_id uuid NOT NULL REFERENCES art_brief_files(id) ON DELETE CASCADE,
  brief_id uuid NOT NULL REFERENCES art_briefs(id) ON DELETE CASCADE,
  sender_role text NOT NULL CHECK (sender_role IN ('hpd', 'designer', 'client')),
  body text NOT NULL CHECK (length(trim(body)) > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_abfc_file_created ON art_brief_file_comments(file_id, created_at);
CREATE INDEX IF NOT EXISTS idx_abfc_brief ON art_brief_file_comments(brief_id);

-- Backfill: convert every non-null annotation on art_brief_files into a
-- comment row. For the file's own uploader role, the annotation was set
-- at upload time (use file.created_at). For other roles, the only signal
-- we have is the shared annotation_updated_at — fall back to file
-- created_at if missing.
INSERT INTO art_brief_file_comments (file_id, brief_id, sender_role, body, created_at)
SELECT id, brief_id, 'hpd', hpd_annotation,
  CASE WHEN uploader_role = 'hpd' THEN created_at
       ELSE COALESCE(annotation_updated_at, created_at)
  END
FROM art_brief_files
WHERE hpd_annotation IS NOT NULL AND length(trim(hpd_annotation)) > 0;

INSERT INTO art_brief_file_comments (file_id, brief_id, sender_role, body, created_at)
SELECT id, brief_id, 'designer', designer_annotation,
  CASE WHEN uploader_role = 'designer' THEN created_at
       ELSE COALESCE(annotation_updated_at, created_at)
  END
FROM art_brief_files
WHERE designer_annotation IS NOT NULL AND length(trim(designer_annotation)) > 0;

INSERT INTO art_brief_file_comments (file_id, brief_id, sender_role, body, created_at)
SELECT id, brief_id, 'client', client_annotation,
  CASE WHEN uploader_role = 'client' THEN created_at
       ELSE COALESCE(annotation_updated_at, created_at)
  END
FROM art_brief_files
WHERE client_annotation IS NOT NULL AND length(trim(client_annotation)) > 0;

-- RLS — service role bypasses; portal/HPD writes go through admin client
-- in API routes after token/session verification, so no row-level rules
-- needed here.
ALTER TABLE art_brief_file_comments ENABLE ROW LEVEL SECURITY;
