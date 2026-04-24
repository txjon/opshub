ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS client_hub_enabled boolean NOT NULL DEFAULT false;
