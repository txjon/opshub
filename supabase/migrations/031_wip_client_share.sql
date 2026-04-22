-- ── WIP client share ──
-- By default WIP files are designer ↔ HPD only. HPD can optionally push a
-- specific WIP to the client for a direction check. When shared, the client
-- sees it in their portal with Comment / Approve-direction CTAs. State
-- doesn't advance — designer still uploads first_draft as the thing that
-- flips to client_review.

ALTER TABLE art_brief_files
  ADD COLUMN IF NOT EXISTS shared_with_client_at timestamptz;

-- Index for the client-portal file filter (kind='wip' AND shared IS NOT NULL)
CREATE INDEX IF NOT EXISTS art_brief_files_shared_idx
  ON art_brief_files(brief_id, shared_with_client_at)
  WHERE shared_with_client_at IS NOT NULL;
