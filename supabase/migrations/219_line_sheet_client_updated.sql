-- The board's "client updated" stamp (Jon, Nov 27 2026): the last time the
-- CLIENT answered or wrote on any card (a verdict or a note; looking doesn't
-- count, and HPD acting from the client link doesn't either). Only the last
-- one, no history. Backfilled from the newest verdict the client set.
ALTER TABLE line_sheets ADD COLUMN IF NOT EXISTS client_updated_at timestamptz;

UPDATE line_sheets s SET client_updated_at = x.at
FROM (
  SELECT sheet_id, max(client_verdict_at) AS at
  FROM line_sheet_items
  WHERE client_verdict_by = 'client' AND client_verdict_at IS NOT NULL
  GROUP BY sheet_id
) x
WHERE x.sheet_id = s.id AND s.client_updated_at IS NULL;
