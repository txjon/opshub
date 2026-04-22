-- ── Client-initiated abort ──
-- The client can nuke a request from their portal. HPD still sees it for
-- 60 days with a "Repurpose" option (restore to active) before it rolls
-- off. No hard delete — graphic work has reuse value even if the client
-- walks away.

ALTER TABLE art_briefs
  ADD COLUMN IF NOT EXISTS client_aborted_at timestamptz;

-- Index for HPD's "Aborted" section query (WHERE client_aborted_at > now() - interval '60 days')
CREATE INDEX IF NOT EXISTS art_briefs_client_aborted_idx
  ON art_briefs(client_aborted_at)
  WHERE client_aborted_at IS NOT NULL;
