-- Atomic JSONB updates on companies.branding for dashboard
-- messenger state (last_dashboard_seen_at + dashboard_unread_overrides).
--
-- The earlier app-level pattern was read-modify-write on the whole
-- branding object, which raced: /seen would read a snapshot, then
-- /mark-unread would write a new override, then /seen would write back
-- and overwrite the override. Same hazard between two simultaneous
-- /mark-unread calls.
--
-- These functions touch only the specific JSON key, so concurrent
-- callers don't fight over the rest of branding.

create or replace function bump_dashboard_seen(p_company_id uuid, p_ts text)
returns void
language sql
as $$
  update companies
  set branding = jsonb_set(coalesce(branding, '{}'::jsonb), '{last_dashboard_seen_at}', to_jsonb(p_ts))
  where id = p_company_id;
$$;

create or replace function add_dashboard_unread_override(p_company_id uuid, p_card_id text)
returns void
language plpgsql
as $$
declare
  current_list jsonb;
  next_list jsonb;
begin
  select coalesce(branding -> 'dashboard_unread_overrides', '[]'::jsonb)
  into current_list
  from companies where id = p_company_id;
  -- Dedupe: skip if cardId already present
  if current_list @> to_jsonb(array[p_card_id]) then
    return;
  end if;
  next_list := current_list || to_jsonb(p_card_id);
  update companies
  set branding = jsonb_set(coalesce(branding, '{}'::jsonb), '{dashboard_unread_overrides}', next_list)
  where id = p_company_id;
end;
$$;

create or replace function remove_dashboard_unread_override(p_company_id uuid, p_card_id text)
returns void
language plpgsql
as $$
declare
  current_list jsonb;
  next_list jsonb;
begin
  select coalesce(branding -> 'dashboard_unread_overrides', '[]'::jsonb)
  into current_list
  from companies where id = p_company_id;
  select coalesce(jsonb_agg(x), '[]'::jsonb)
  into next_list
  from jsonb_array_elements_text(current_list) as x
  where x <> p_card_id;
  update companies
  set branding = jsonb_set(coalesce(branding, '{}'::jsonb), '{dashboard_unread_overrides}', next_list)
  where id = p_company_id;
end;
$$;

grant execute on function bump_dashboard_seen(uuid, text) to authenticated, service_role;
grant execute on function add_dashboard_unread_override(uuid, text) to authenticated, service_role;
grant execute on function remove_dashboard_unread_override(uuid, text) to authenticated, service_role;
