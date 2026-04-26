-- ── Server-rendered preview image for files Drive can't auto-thumbnail ──
-- Drive auto-thumbnails most images but breaks on layered PSDs, AI files,
-- and very large TIFFs. We parse those formats server-side, render a JPG/
-- PNG composite, and store its drive_file_id here. Tile + lightbox URLs
-- prefer this when set, fall back to drive_file_id.

ALTER TABLE art_brief_files
  ADD COLUMN IF NOT EXISTS preview_drive_file_id text;
