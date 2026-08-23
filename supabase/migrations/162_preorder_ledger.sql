-- 162 — PRE-ORDER LEDGER (Continuum Phase 4, Aug 20 2026).
--
-- A pre-order release line is a per-size ledger of three numbers, only the
-- first manual:
--   sold      — Shopify truth, typed/imported at decision moments
--   bought    — Σ size curves of the BUY jobs linked to the line
--   delivered — Σ items.received_qtys as those buys land through receiving
-- Rolling buys = N jobs per release (sample run → mid-window → close-out),
-- each a normal job; suggest-next-buy = max(0, ceil(sold×(1+overage%)) − bought).
--
-- Linkage (the N-runs model the mig-134 single job_id/item_id couldn't hold):
--   jobs.release_id        — which release a buy job belongs to
--   items.release_slot_id  — which LINE a run fulfills (aggregation key)
-- Existing runs mid-campaign (FOG's live pre-order) attach by stamping
-- items.release_slot_id — no data moves.

alter table jobs add column if not exists release_id uuid references releases(id) on delete set null;
create index if not exists idx_jobs_release on jobs(release_id);

alter table items add column if not exists release_slot_id uuid references release_slots(id) on delete set null;
create index if not exists idx_items_release_slot on items(release_slot_id);

-- Per-size sold (sold_units stays as the legacy total; per-size is the ledger)
alter table release_slots add column if not exists sold_qtys jsonb not null default '{}';
alter table release_slots add column if not exists sold_updated_at timestamptz;
-- Per-line overage policy, percent (default 4 — matches current practice)
alter table release_slots add column if not exists overage_pct numeric not null default 4;
