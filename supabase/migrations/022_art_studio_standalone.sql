-- Art Studio: allow standalone briefs (no item/job required)
-- Briefs can exist for a client concept before a project is created

ALTER TABLE art_briefs ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE art_briefs ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE art_briefs ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS art_briefs_client_id_idx ON art_briefs(client_id);

-- Same for client requests — they might come in before a project exists
ALTER TABLE art_client_requests ALTER COLUMN item_id DROP NOT NULL;
ALTER TABLE art_client_requests ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE art_client_requests ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS art_client_requests_client_id_idx ON art_client_requests(client_id);
