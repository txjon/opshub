-- Phase 6 — narrow gods to the active tenant when a subdomain is set.
--
-- Before this: current_user_company_ids() returned ALL active companies
-- for gods. Result: when Jon (god) visited app.inhousemerchandise.com,
-- he still saw HPD data because RLS allowed both tenants.
--
-- After this: the function reads the x-company-slug header that the
-- app's Supabase client now attaches to every request. If the calling
-- session is on a specific subdomain, gods get narrowed to ONLY that
-- tenant. If the header is absent, gods see all companies (preserves
-- prior behavior for any caller without subdomain context).
--
-- Non-gods: same narrowing applied. If they're on the IHM domain but
-- only a member of HPD, they see nothing — which is correct (the
-- layout's tenant gate already redirects them in that case, but RLS
-- as defense-in-depth shouldn't return data either).

CREATE OR REPLACE FUNCTION public.current_user_company_ids()
RETURNS uuid[]
LANGUAGE plpgsql STABLE SECURITY DEFINER
AS $$
DECLARE
  active_slug text;
  active_id uuid;
  is_god_user boolean;
BEGIN
  -- Read the active tenant slug from the per-request header attached
  -- by the Next app layer (middleware sets it; lib/supabase/server.ts
  -- forwards it to Supabase requests). Wrapped in BEGIN/EXCEPTION
  -- because current_setting throws if request.headers is unset (which
  -- can happen for service-role calls from cron jobs / scripts).
  BEGIN
    active_slug := nullif(current_setting('request.headers', true)::jsonb->>'x-company-slug', '');
  EXCEPTION WHEN OTHERS THEN
    active_slug := NULL;
  END;

  IF active_slug IS NOT NULL THEN
    SELECT id INTO active_id FROM companies WHERE slug = active_slug AND is_active = true;
  END IF;

  SELECT COALESCE(is_god, false) INTO is_god_user FROM profiles WHERE id = auth.uid();

  IF is_god_user THEN
    -- God + active subdomain → narrow to that tenant only.
    -- God without subdomain context → see everything (admin scripts).
    IF active_id IS NOT NULL THEN
      RETURN ARRAY[active_id];
    ELSE
      RETURN ARRAY(SELECT id FROM companies WHERE is_active = true);
    END IF;
  ELSE
    -- Non-gods: their memberships, narrowed by active subdomain when set.
    IF active_id IS NOT NULL THEN
      RETURN ARRAY(
        SELECT company_id FROM user_company_memberships
        WHERE user_id = auth.uid() AND company_id = active_id AND is_active = true
      );
    ELSE
      RETURN ARRAY(
        SELECT company_id FROM user_company_memberships
        WHERE user_id = auth.uid() AND is_active = true
      );
    END IF;
  END IF;
END;
$$;
