-- 179 — INBOX CLEARED (Sep 15 2026). The House's inbox: external words that
-- need a reply (quote rejections, proof revision requests, vendor flags,
-- brief activity) stay open until they resolve naturally or a person clears
-- them as handled. This table records the manual clears. Keys embed the
-- occurrence (file id, notes hash) so a NEW occurrence re-opens on its own.
--
-- Replaces the Dashboard's team-wide "last seen" clock + manual unread
-- overrides (mig 070/071) — those functions are dropped below.

create table if not exists inbox_cleared (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete cascade,
  key text not null,
  cleared_at timestamptz not null default now(),
  cleared_by text,
  note text,
  unique (company_id, key)
);
create index if not exists idx_inbox_cleared_company on inbox_cleared(company_id);

-- company_id stamp on insert (house pattern, mig 134)
drop trigger if exists fill_company_id on inbox_cleared;
create trigger fill_company_id before insert on inbox_cleared
  for each row execute function default_company_id_to_hpd();

alter table inbox_cleared enable row level security;
drop policy if exists inbox_cleared_all on inbox_cleared;
create policy inbox_cleared_all on inbox_cleared
  for all to authenticated using (true) with check (true);

grant all on inbox_cleared to service_role;
grant select, insert, update, delete on inbox_cleared to authenticated;

-- the dashboard messenger model is gone
drop function if exists bump_dashboard_seen(uuid, text);
drop function if exists add_dashboard_unread_override(uuid, text);
drop function if exists remove_dashboard_unread_override(uuid, text);
drop function if exists prune_dashboard_unread_overrides(uuid, text[]);
