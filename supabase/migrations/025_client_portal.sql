-- Client portal: one permanent token per client so HPD can send a single
-- link that covers every art request they have open.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS portal_token text UNIQUE;
CREATE INDEX IF NOT EXISTS clients_portal_token_idx ON clients(portal_token);

-- Backfill tokens for existing clients
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM clients WHERE portal_token IS NULL LOOP
    UPDATE clients SET portal_token = encode(gen_random_bytes(16), 'hex')
      WHERE id = r.id;
  END LOOP;
END $$;

-- Ensure tokens auto-populate on new client inserts
CREATE OR REPLACE FUNCTION generate_client_portal_token()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.portal_token IS NULL OR NEW.portal_token = '' THEN
    NEW.portal_token := encode(gen_random_bytes(16), 'hex');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_portal_token ON clients;
CREATE TRIGGER trg_client_portal_token
  BEFORE INSERT ON clients
  FOR EACH ROW
  EXECUTE FUNCTION generate_client_portal_token();
