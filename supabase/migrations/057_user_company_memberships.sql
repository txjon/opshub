-- User ↔ company memberships. Every user belongs to one or more
-- companies. The active company at request time is determined by the
-- subdomain (middleware reads Host header → companies.slug → company_id),
-- and the user's membership for that company controls whether they can
-- see that tenant's data.
--
-- Gods (Jon as owner of both HPD and IHM) cross the tenant wall via
-- profiles.is_god — they're effectively a member of every company
-- regardless of explicit memberships.
--
-- Existing users are backfilled into HPD with their current role/dept
-- preserved. role here is per-company so a user can be `owner` in one
-- and `viewer` in another.

CREATE TABLE IF NOT EXISTS user_company_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'manager', 'ops', 'staff', 'warehouse', 'viewer')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, company_id)
);

CREATE INDEX IF NOT EXISTS idx_user_company_memberships_user ON user_company_memberships(user_id) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_user_company_memberships_company ON user_company_memberships(company_id) WHERE is_active = true;

ALTER TABLE user_company_memberships ENABLE ROW LEVEL SECURITY;

-- Users can read their own memberships (so the AppShell can render the
-- company picker for gods). Owners can manage memberships.
DROP POLICY IF EXISTS "Users read own memberships" ON user_company_memberships;
CREATE POLICY "Users read own memberships"
  ON user_company_memberships FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Owners manage memberships" ON user_company_memberships;
CREATE POLICY "Owners manage memberships"
  ON user_company_memberships FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'owner')
  );

-- profiles.is_god — bypasses the membership check at request time.
-- Jon's account gets this set to true; nobody else by default. The
-- AppShell uses this to show the cross-company switch link.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS is_god boolean NOT NULL DEFAULT false;

-- Backfill: every existing profile gets a membership in HPD with the
-- role they already have on profiles.role (or 'viewer' as fallback).
-- Idempotent on rerun via the UNIQUE constraint + ON CONFLICT.
INSERT INTO user_company_memberships (user_id, company_id, role, is_active)
SELECT
  p.id,
  (SELECT id FROM companies WHERE slug = 'hpd'),
  COALESCE(p.role, 'viewer'),
  true
FROM profiles p
WHERE EXISTS (SELECT 1 FROM companies WHERE slug = 'hpd')
ON CONFLICT (user_id, company_id) DO NOTHING;

-- Mark Jon as god so he can switch into IHM context once it's seeded.
UPDATE profiles
SET is_god = true
WHERE id IN (
  SELECT id FROM auth.users WHERE email = 'jon@housepartydistro.com'
);

-- Helper function — returns the array of company_ids the calling user
-- can see. Gods see every active company. Used by future RLS policies
-- on scoped tables (Phase 2) and by app code looking up "which tenants
-- can this user pick?"
CREATE OR REPLACE FUNCTION public.current_user_company_ids()
RETURNS uuid[]
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT CASE
    WHEN COALESCE((SELECT is_god FROM profiles WHERE id = auth.uid()), false) THEN
      ARRAY(SELECT id FROM companies WHERE is_active = true)
    ELSE
      ARRAY(SELECT company_id FROM user_company_memberships
            WHERE user_id = auth.uid() AND is_active = true)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.current_user_company_ids() TO authenticated;
