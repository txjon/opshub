-- QuickBooks OAuth token storage (one row)
CREATE TABLE IF NOT EXISTS qb_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  realm_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE qb_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role can manage qb_tokens"
  ON qb_tokens FOR ALL
  USING (true)
  WITH CHECK (true);

-- QB customer ID on clients
ALTER TABLE clients ADD COLUMN IF NOT EXISTS qb_customer_id text;
