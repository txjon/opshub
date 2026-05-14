-- Prune stale entries from companies.branding.dashboard_unread_overrides.
-- Called from the dashboard server render once it knows the set of
-- card IDs it just generated: anything in the override list that
-- isn't in that set is orphaned (card no longer exists, ID format
-- changed, etc.) and gets dropped. Keeps the badge count honest.

create or replace function prune_dashboard_unread_overrides(p_company_id uuid, p_valid_card_ids text[])
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
  where x = any(p_valid_card_ids);

  update companies
  set branding = jsonb_set(coalesce(branding, '{}'::jsonb), '{dashboard_unread_overrides}', next_list)
  where id = p_company_id;
end;
$$;

grant execute on function prune_dashboard_unread_overrides(uuid, text[]) to authenticated, service_role;
