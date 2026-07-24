-- Explicit "proof was sent to the client" signal (Jon, 2026-07-23). A baked PDF
-- existing does NOT mean sent — exit/download bake a Drive PDF incidentally. Only
-- the Send action sets this. Drives the proof state: proof_spec + null → Draft;
-- proof_sent_at set → Pending client.
ALTER TABLE items ADD COLUMN IF NOT EXISTS proof_sent_at timestamptz;
COMMENT ON COLUMN items.proof_sent_at IS 'When the item''s proof was actually sent to the client (Send action only). NULL = draft/unsent even if a proof PDF has been baked to Drive.';
