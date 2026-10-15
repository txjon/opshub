-- 204: a client's only active contact is its main contact (Jon, Oct 15 2026).
-- Enforced here so every writer (client page, new project, intake/lead convert,
-- hub info form) follows it. "Active" = not removed from emails (doc_routing
-- doesn't contain 'none'), matching lib/client-info.
create or replace function enforce_sole_contact_main() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid; n int; only_id uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  cid := coalesce(new.client_id, old.client_id);
  if cid is null then return null; end if;
  select count(*), min(id::text)::uuid into n, only_id from contacts
   where client_id = cid and (doc_routing is null or not doc_routing @> array['none']);
  if n = 1 then
    update contacts set is_primary = true where id = only_id and is_primary is not true;
  end if;
  if tg_op = 'UPDATE' and old.client_id is distinct from new.client_id and old.client_id is not null then
    select count(*), min(id::text)::uuid into n, only_id from contacts
     where client_id = old.client_id and (doc_routing is null or not doc_routing @> array['none']);
    if n = 1 then update contacts set is_primary = true where id = only_id and is_primary is not true; end if;
  end if;
  return null;
end $$;

drop trigger if exists trg_sole_contact_main on contacts;
create trigger trg_sole_contact_main after insert or update or delete on contacts
  for each row execute function enforce_sole_contact_main();
