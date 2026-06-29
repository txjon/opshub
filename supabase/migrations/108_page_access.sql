-- Per-user page-level access (permissions model — see opshub-permissions-plan.md).
-- A text[] of page keys (= hrefs from lib/access.ts PAGE_CATALOG) the user may reach.
--
-- NULLABLE BY DESIGN: NULL / empty = fall back to the legacy role->department rule, so
-- any user not yet seeded keeps exactly the access they have today (fail-safe rollout).
-- The middleware enforces this server-side; AppShell renders nav from it.
alter table profiles add column if not exists page_access text[];

comment on column profiles.page_access is
  'Per-user allowed page keys (hrefs, see lib/access.ts). NULL/empty = legacy role-based fallback.';
