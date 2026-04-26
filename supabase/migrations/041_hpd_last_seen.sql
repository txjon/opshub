-- ── HPD mark-as-read on first open ──
-- Lets the dashboard clear unread ribbons when HPD opens a brief, even
-- before they post anything on it. We compare external-role timestamps
-- against this in the list-rollup query (max(hpd_activity_at, hpd_last_seen_at))
-- to decide has_unread_external.

ALTER TABLE art_briefs
  ADD COLUMN IF NOT EXISTS hpd_last_seen_at timestamptz;
