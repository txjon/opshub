# OpsHub Permissions Plan — per-user page access

Decided 2026-06-29 with Jon. Replaces role→department bundles with **per-user, page-level
grants**, enforced (not just nav-hidden). Source of truth for grants = `opshub-access-map.csv`.

## Why
Team is ~6 people, all different. Roles are over-abstraction at this size; "this person sees
these pages" is clearer + matches what Jon actually wants (e.g. Dante can Log Hours, Goose can't —
same Distro area, different access, which roles can't express without a one-off role per person).

## The access matrix (from the filled CSV)
- **Jon** — everything (owner/god).
- **Corey** — co-owner: everything EXCEPT Team & Access and Log Hours (incl. all financials).
- **Drake, Taylor** — operators: Labs (Dashboard, Projects, Art Studio, Production) + Distro (all)
  + Ecomm + Contacts (Intake, Clients, Decorators, Designers) + Toolkit + References. NO financials,
  NO Log Hours, NO Team.
- **Dante** — Production + Distro (all) + Ecomm + **Log Hours** + References.
- **Goose** — Dante MINUS Log Hours.
- **Abigail** — **Billing** + References only (bookkeeper).
- **Adrien** — IHM tenant, phasing out → not part of HPD access model.

## Sensitive pages (the real lock targets — URL-reachable today regardless of nav)
God Mode, Reports, Reconciliation, Integrations, Team & Access.

## Structural changes
1. **Extract `/billing` out of `/reconciliation`** — bill ENTRY + per-line INLINE variance
   (projected vs billed, so Abigail flags mis-bills) + **QB push (Abigail pushes bills herself —
   confirmed)**. EXCLUDES the aggregate/total variance + margin-impact views (owner-only, stay in
   Reconciliation / God Mode).
2. **Promote `/hours`** to a grantable nav item (today buried owner-only) so it can go to Dante.
3. **Retire** `/warehouse` (legacy, superseded by Distro) + `/templates`.

## Build phases
**Phase 1 — access engine (core + the real security fix)**
- Page catalog: the ~20 pages from the CSV, one constant in code.
- Per-user grants stored on profile (evolve `extra_access` → explicit page list), seeded from CSV.
- `requirePageAccess` guard: every gated page checks server-side, redirects non-grantees.
  (Today only /god-mode guards server-side; the rest is nav-hiding only — this is the gap.)
- Nav rendered from grants (retires role→department derivation in AppShell + layout.tsx).

**Phase 1.5 — fold in the surfaces**
- `/hours`: already exists (kiosk) → add to catalog, grant Dante. Trivial.
- `/billing`: extract from Reconciliation per the split above → grant Abigail.
- RLS alignment: extend AP data rules (can_manage_ap) so a billing-granted user can read/write
  bills + see per-line projection, WITHOUT opening the owner financial tables.

**Phase 2 — Team & Access screen (`/settings`, owner-only)**
- The CSV as a live toggle grid so Jon changes anyone's access without code.

## Open questions
- None — spec complete 2026-06-29. Abigail pushes bills to QB herself (confirmed).

## Notes
- Keep a simple `is_owner` capability (who may edit others' access) — even "no roles" needs an admin.
- Hours→QB-bill billing feature (the original ask) folds in once `/hours` + `/billing` are grantable
  pages — see [[opshub-hours-tool]] / [[opshub-qb-bill-workflow]].
