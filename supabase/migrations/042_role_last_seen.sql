-- ── Per-role mark-as-read on first open ──
-- Mirrors the HPD pattern from migration 041 for the other two roles.
-- When a designer or client opens a brief, the GET-by-id endpoint bumps
-- their *_last_seen_at; the listing rollup factors that into their
-- side's "last activity" timestamp so unread ribbons clear without
-- requiring them to post.

ALTER TABLE art_briefs
  ADD COLUMN IF NOT EXISTS designer_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_last_seen_at timestamptz;
