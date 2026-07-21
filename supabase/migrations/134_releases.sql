-- 134 — RELEASES: the drop as a first-class object (Jul 21 2026).
--
-- The missing noun between product development and production. Hierarchy:
--   CLIENT → IDEAS (art_briefs; pre-items, each with product_spec.products[]
--   lines) → RELEASE (gathers lines ACROSS ideas into one dated drop) →
--   JOB/ITEMS (born when the release is cut).
--
-- Corey's one-sheet flow (supdef session) mapped: idea-level steps (mockups,
-- approvals, per-line notes) stay on the brief; release-level steps (go live
-- on ecomm, sell, enter production numbers, payable) hang here.
--
--   releases       — the dated drop: client, title, model intent, target
--                    dates, lifecycle status, job link once cut.
--   release_slots  — one row per product line pulled onto the release.
--                    Points at (brief_id, line_id) for live sync AND carries
--                    a snapshot (format/retail/model/notes) taken at slot
--                    time so client edits after lock don't silently move the
--                    deal. Client-entered per-size production numbers land in
--                    qtys; ecomm sell-through lands in sold_units; item_id
--                    stamps at cut.
--
-- Lifecycle (status): building → ready → live → closed → cut. shelved = ice.
--   building — client (or team) assembling lines, mockups still approving
--   ready    — readiness gate passed (every contributing idea approved)
--   live     — pre-order/webstore selling (ecomm refs in meta)
--   closed   — window closed; numbers being entered/confirmed
--   cut      — job born (releases.job_id, slots.item_id); terminal
--   shelved  — parked, no countdowns
-- status_timestamps mirrors jobs.phase_timestamps.

create table if not exists releases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  status text not null default 'building'
    check (status in ('building','ready','live','closed','cut','shelved')),
  model text check (model in ('preorder','stock')),  -- intent; slots carry their own
  target_live_date date,           -- backward-chain anchor (web-live)
  window_close_date date,          -- pre-order window end
  notes text,                      -- ops-side notes
  meta jsonb not null default '{}',-- ecomm refs (shopify collection/urls), totals
  job_id uuid references jobs(id) on delete set null,  -- born at cut
  status_timestamps jsonb not null default '{}',
  cut_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_releases_client on releases(client_id);
create index if not exists idx_releases_status on releases(status);

create table if not exists release_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  release_id uuid not null references releases(id) on delete cascade,
  brief_id uuid not null references art_briefs(id) on delete cascade,
  line_id text not null,           -- product_spec.products[].id within the brief
  -- snapshot at slot time (live pointer above stays for sync/deep-link)
  format text,
  retail numeric,
  model text check (model in ('preorder','stock')),
  line_notes text,
  -- commerce results
  sold_units integer,              -- ecomm sell-through total
  qtys jsonb not null default '{}',-- client-entered per-size production numbers
  qtys_confirmed_at timestamptz,   -- ops confirmed the numbers
  item_id uuid references items(id) on delete set null,  -- born at cut
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (release_id, brief_id, line_id)
);
create index if not exists idx_release_slots_release on release_slots(release_id);
create index if not exists idx_release_slots_brief on release_slots(brief_id);

-- ── RLS: permissive team policy + restrictive company scope (house pattern,
--        mirrors migration 117) ─────────────────────────────────────────
do $$
declare
  tbl text;
begin
  foreach tbl in array array['releases', 'release_slots'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format(
      'create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format(
      'create trigger fill_company_id before insert on %I
       for each row execute function default_company_id_to_hpd()', tbl);
    execute format('drop policy if exists company_scope_restrictive on %I', tbl);
    execute format(
      'create policy company_scope_restrictive on %I as restrictive
       for all to authenticated
       using (company_id = any(public.current_user_company_ids()))
       with check (company_id = any(public.current_user_company_ids()))',
      tbl
    );
  end loop;
end $$;
