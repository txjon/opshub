-- Proof supersede: preserve DB rows when proofs are regenerated so history +
-- aggregate counters stay accurate. Drive file is still deleted (folder on
-- Drive is the physical archive for reorders).

ALTER TABLE item_files ADD COLUMN IF NOT EXISTS superseded_at timestamptz;

-- Partial index for the hot path: active proofs per item.
CREATE INDEX IF NOT EXISTS idx_item_files_active_proofs
  ON item_files(item_id, stage) WHERE superseded_at IS NULL;

-- Backfill: any existing proof row that has a newer proof row for the same
-- item is retroactively marked superseded. Timestamp uses the newer row's
-- created_at (or now() as a fallback).
UPDATE item_files f
SET superseded_at = COALESCE(
  (SELECT MIN(newer.created_at) FROM item_files newer
   WHERE newer.item_id = f.item_id AND newer.stage = 'proof'
     AND newer.created_at > f.created_at),
  NOW()
)
WHERE f.stage = 'proof' AND f.superseded_at IS NULL
  AND EXISTS (
    SELECT 1 FROM item_files newer
    WHERE newer.item_id = f.item_id AND newer.stage = 'proof'
      AND newer.created_at > f.created_at
  );
