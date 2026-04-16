-- Art Studio: client intake fields
-- Client fills out 5 quick fields via magic link, HPD translates into full brief

ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS purpose text;
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS audience text;
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS mood_words jsonb DEFAULT '[]';
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS no_gos text;
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS client_intake_token text UNIQUE;
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS client_intake_submitted_at timestamptz;

CREATE INDEX IF NOT EXISTS art_briefs_intake_token_idx ON art_briefs(client_intake_token);

-- Per-reference annotations (client says one thing, HPD notes another for designer)
ALTER TABLE art_brief_files ADD COLUMN IF NOT EXISTS client_annotation text;
ALTER TABLE art_brief_files ADD COLUMN IF NOT EXISTS hpd_annotation text;
