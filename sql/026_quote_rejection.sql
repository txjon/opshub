-- Quote rejection notes from client portal
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS quote_rejection_notes text;
