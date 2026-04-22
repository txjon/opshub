-- ── Per-image comments, three-way ──
-- Each image (any kind — reference, WIP, first_draft, revision, final) can
-- now carry one note per party. All three notes are visible to all three
-- parties on any surface (OpsHub Art Studio, designer portal, client portal).
-- Each party edits only their own note. No overwrites.

ALTER TABLE art_brief_files
  ADD COLUMN IF NOT EXISTS designer_annotation text;
