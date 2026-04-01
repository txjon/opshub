-- Add client profile fields: website, addresses, tax exempt
-- Remove client_type constraint (column stays nullable, just stop using it)

ALTER TABLE clients ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS shipping_address text;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS tax_exempt boolean NOT NULL DEFAULT false;
