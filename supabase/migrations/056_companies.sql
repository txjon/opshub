-- Multi-tenant foundation. Each company gets one row here; every
-- scoped table will FK to it. HPD is seeded so all existing data has
-- a target to backfill into. IHM (and any future tenants) are added
-- via the standard insert path once their branding/billing details
-- are known.
--
-- Conventions:
--   slug                — short stable identifier used in URLs / domain
--                         routing (`hpd`, `ihm`)
--   job_number_prefix   — drives the auto-generated job number format
--                         (existing trigger prefixes "HPD-"; new trigger
--                         in mig 058 will read this column instead)
--   default_payment_provider — controls which integration the Invoice
--                         tab uses (`quickbooks` for HPD, `stripe` for
--                         IHM at launch)
--   warehouse_address   — null means this tenant has no warehouse and
--                         must route physical fulfillment to a partner
--                         tenant via cross_company_fulfillment_requests
--   branding            — open jsonb for non-structured tenant chrome
--                         (logo svg, accent color overrides, etc.)

CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  job_number_prefix text NOT NULL DEFAULT 'JOB',
  default_payment_provider text NOT NULL DEFAULT 'quickbooks' CHECK (default_payment_provider IN ('quickbooks', 'stripe')),
  bill_to_address text,
  warehouse_address text,
  from_email_quotes text,
  from_email_production text,
  from_email_billing text,
  branding jsonb DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_companies_slug ON companies(slug) WHERE is_active = true;

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated users can read companies" ON companies;
CREATE POLICY "Authenticated users can read companies"
  ON companies FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS "Owners can manage companies" ON companies;
CREATE POLICY "Owners can manage companies"
  ON companies FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
  );

-- Seed HPD with the correct addresses + emails so existing PDFs/emails
-- can start reading from this row instead of inline strings.
INSERT INTO companies (slug, name, legal_name, job_number_prefix, default_payment_provider, bill_to_address, warehouse_address, from_email_quotes, from_email_production, from_email_billing)
VALUES (
  'hpd',
  'House Party Distro',
  'House Party Distro LLC',
  'HPD',
  'quickbooks',
  '3945 W Reno Ave, Ste A, Las Vegas, NV 89118',
  '4670 W Silverado Ranch Blvd, STE 120, Las Vegas, NV 89139',
  'hello@housepartydistro.com',
  'production@housepartydistro.com',
  'billing@housepartydistro.com'
)
ON CONFLICT (slug) DO NOTHING;
