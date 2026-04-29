-- Client-level files — tax-exempt docs, resale certs, non-profit
-- determinations, anything else we need to keep on file per client.
-- Actual file bytes live in Google Drive under
-- OpsHub Files / Clients / {Client Name} / Tax Documents /
-- Mirrors item_files (migration 008).

CREATE TABLE IF NOT EXISTS client_files (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id     uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name     text NOT NULL,
  drive_file_id text,
  drive_link    text,
  mime_type     text,
  file_size     bigint,
  -- "tax_exempt" covers resale certs, non-profit determinations, etc.
  -- Add more kinds (e.g., "w9", "msa", "noc") as the need shows up.
  kind          text NOT NULL DEFAULT 'tax_exempt' CHECK (kind IN ('tax_exempt','w9','msa','other')),
  notes         text,
  uploaded_by   uuid REFERENCES auth.users(id),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_client_files_client_id ON client_files(client_id);

-- RLS — same pattern as item_files. Authenticated team members can
-- read/write; anon clients never touch this table directly (uploads
-- happen through API routes that auth-check first).
ALTER TABLE client_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage client files"
  ON client_files FOR ALL
  USING (auth.role() = 'authenticated')
  WITH CHECK (auth.role() = 'authenticated');
