-- Fix RLS policies that reference old phase values
DROP POLICY IF EXISTS "production sees production jobs" ON jobs;
CREATE POLICY "production sees production jobs" ON jobs FOR SELECT
  USING (get_user_role() = 'production' AND phase IN ('pending', 'ready', 'production'));

DROP POLICY IF EXISTS "shipping sees shipping jobs" ON jobs;
CREATE POLICY "shipping sees shipping jobs" ON jobs FOR SELECT
  USING (get_user_role() = 'shipping' AND phase IN ('receiving', 'fulfillment'));
