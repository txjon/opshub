-- 119 — The movement ledger (V2 ship-from-production rebuild, schema).
--
-- The core fix for "no audit trail": every quantity that moves becomes ONE
-- immutable row. Nothing is overwritten. Every total (shipped, received,
-- forwarded, staged) is SUMMED from these rows, so it is always accurate and
-- always carries who / when / how-many / which box. This replaces the mutable
-- items.ship_qtys / received_qtys / shipment_lines.*_qtys model — it does not
-- patch it.
--
-- Deliberately NOT touched here (they already work, own their own history):
--   pull_requests / pulled_inventory  — pulls, cut over in 117.
--   shipments                         — stays as the physical-box grouping;
--                                       ship/receive/forward movements point at it.
-- shipment_lines keeps existing for now but stops being quantity-truth once the
-- ship flow writes movements — readers migrate off it, then it retires.
--
-- This migration is SCHEMA ONLY. The legacy backfill (seed a ship movement per
-- already-shipped item) is a separate migration (120) run after this is in.

-- ── movements — THE LEDGER ─────────────────────────────────────────────
-- Append-only. A row is written, never updated or deleted. A correction is a
-- NEW row: a negative-qty row of the same type, tagged with reverses_id + a
-- reason, so the mistake and the fix both stay on the record. Net of any type
-- is a plain sum of its qtys (reversals net to zero) — no joins to derive state.
create table if not exists movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  item_id uuid references items(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  description text,                    -- item name snapshot — survives item deletion
  type text not null check (type in ('ship','receive','forward','stage','adjust')),
  qtys jsonb not null default '{}',    -- per-size units moved in THIS event (a reversal carries negatives)
  shipment_id uuid references shipments(id) on delete set null,   -- the box (ship/receive/forward)
  packing_slip_id uuid,                -- the frozen doc this event was documented on
  tracking text,                       -- denormalized convenience (also on the shipment)
  reason text,                         -- required in app code for adjust / reversal rows
  source text not null default 'app' check (source in ('app','legacy','backfill','import')),
  reverses_id uuid references movements(id) on delete set null,   -- if a reversal, the row it cancels
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists idx_movements_item on movements(item_id);
create index if not exists idx_movements_job on movements(job_id);
create index if not exists idx_movements_type on movements(type);
create index if not exists idx_movements_shipment on movements(shipment_id);

-- ── packing_slips — FROZEN DOCUMENT ────────────────────────────────────
-- A snapshot captured at send, not a live re-render. The slip a client got in
-- January reproduces byte-for-byte in April even if the job later changes.
create table if not exists packing_slips (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  shipment_id uuid references shipments(id) on delete set null,
  job_id uuid references jobs(id) on delete set null,
  client_id uuid references clients(id) on delete set null,
  slip_number text,                    -- human reference (e.g. HPD-PS-0001)
  frozen_lines jsonb not null,         -- [{item, description, sizes, qtys, ...}] AT SEND TIME
  tracking text,
  carrier text,
  pdf_url text,                        -- rendered PDF (Google Drive)
  drive_file_id text,
  generated_by uuid,
  generated_by_name text,
  generated_at timestamptz not null default now(),
  sent_at timestamptz,
  sent_to text                         -- recipient email(s) the slip went to
);
create index if not exists idx_packing_slips_shipment on packing_slips(shipment_id);
create index if not exists idx_packing_slips_job on packing_slips(job_id);
create index if not exists idx_packing_slips_client on packing_slips(client_id);

-- ── RLS: permissive team policy + restrictive company scope (house pattern,
--        identical to migration 117) ─────────────────────────────────────
do $$
declare
  tbl text;
  new_tables text[] := array['movements', 'packing_slips'];
begin
  foreach tbl in array new_tables loop
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
