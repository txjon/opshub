-- 132 — Per-client hub feature grants (Client Hub V2 P3, Jul 21 2026).
--
-- clients.portal_features text[] — which add-on hub surfaces this client
-- gets beyond the standard tier (Home / Orders / Reorder for everyone).
-- Follows the profiles.page_access pattern: explicit grants, empty = standard.
--
-- Feature keys (source of truth = lib/portal/features.ts):
--   'pipeline' — the Pipeline tab: production visibility, revenue/profit
--                insight, drop planner, pull requests. Fulfillment-tier
--                clients only (this is staging + margin data).
--   'studio'   — Product Development (design briefs), currently hidden
--                globally pending rethink; granted clients see it when
--                it returns.

alter table clients add column if not exists portal_features text[] not null default '{}';

comment on column clients.portal_features is
  'Hub add-on grants beyond the standard tier. Keys: pipeline, studio. Empty = standard (Home/Orders/Reorder).';
