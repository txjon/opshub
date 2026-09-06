# OpsHub — House Party Distro

Internal operations platform for House Party Distro (HPD), a custom-apparel
sourcing/production/fulfillment company in Las Vegas. One Next.js deploy, one
Supabase database, multi-tenant by `company_id` + host→slug (HPD is the live
tenant; DMD exists with zero jobs; IHM is decommissioned). Owner: Jon Burrow —
not a developer. Keep changes surgical, verify before shipping, explain what
changed.

> Rewritten 2026-09-05 (the March-era doc misled sessions). If something here
> contradicts the code or the session memory, the code and memory win — and
> fix this file in the same commit.

## MANDATORY: Design standard

**Read `DESIGN.md` before building or changing ANY UI.** It is the locked
house style — signal-color semantics, NO pill chips, note rails, modal
anatomy, mobile-required, date formats. A build that deviates from DESIGN.md
is wrong and will be redone.

## MANDATORY: Before writing any code

1. **Read every file you're about to change.** Not grep. Read.
2. **Find every caller** before changing any signature, prop, or data field.
   List them. Verify them again after the change.
3. **State the plan in plain English first** — what changes, what reads it,
   what needs to update. Confirm scope beyond a UI tweak.
4. **If unsure, ask. Don't guess and ship.**
5. **Trace the full field lifecycle**: every DB write must update every
   reader — sidebar, header, PDFs, portal, hub, other pages. No stale state.

## What "done" means

Not "it compiles." Done = every surface showing the affected data is correct,
no stale state anywhere, and the save path plus every read path verified.

## Verification workflow (the house gates)

- `npx tsc --noEmit` — **the baseline is 0 errors (since Sep 5 2026).** Any
  error is real. `next build` has `ignoreBuildErrors: true`, so a green build
  proves nothing about types. Delete `*.tsbuildinfo` before measuring — the
  incremental cache lies.
- After ANY migration: `node scripts/gen-db-types.mjs` regenerates
  `types/database.ts` from the live DB (PostgREST introspection; no CLI or DB
  password needed). Commit it with the migration.
- Full builds: check the **exit code** of `next build`, never grep the log
  for success strings. Stale `.next` after type-level changes → `rm -rf .next`.
- Big refactors/flips are gated by read-only parity harnesses (pattern:
  `scripts/verify-qty-single-source.ts`, `scripts/verify-costing-summary.cjs`,
  `scripts/qb-reconcile.cjs`) — compute old-way vs new-way across all jobs,
  demand zero unexplained deltas before shipping.
- `/api/cron/costing-health` (6-hourly) tripwires: revenue drift
  (grossRev == Σ sell×qty), phase drift, qty-copy drift, fleece gaps. It
  emails the owner only when something is wrong.

## Deploy & environment

- Branches: work on `dev`, push to origin/dev promptly (Jon runs parallel
  Claude sessions — uncommitted work gets clobbered). **"push" = merge
  dev→main, push main** (Vercel deploys). Dev-only unless Jon says push.
- Migrations: `supabase/migrations/NNN_*.sql`, applied directly via
  `scripts/apply-mig-NNN.js` (exec_sql RPC, service role). New public tables
  need RLS policy + explicit Data API GRANTs (see mig 168 for the pattern).
- Local: Jon's dev server runs on :3000 against the LIVE prod DB — there is
  no staging database. Data scripts here are production writes.

## Money doctrine (the load-bearing invariants)

- **Pricing source of truth: `items.sell_per_unit`** — set by costing,
  rounded to the cent. Quotes, invoices, QB, portal, hub all read it. Never
  recalculate price on an output surface.
- **Quantity source of truth: `buy_sheet_lines.qty_ordered`** — single-source
  since Sep 2026. `costing_data.costProds` NEVER persists `qtys`/`totalQty`
  (writers strip them; `stripQtyCopies` in JobDetailV2). Every money surface
  overlays via `overlayCostProds`/`overlayQtysOnly`/`assembleCostProds` in
  `lib/costing-summary.ts` or resolves buy-sheet lines inline. Never read
  `costProds.qtys` raw.
- **Blank cost: `items.blank_costs` (raw per-size)** is the truth; buffers
  apply at calc time in `lib/pricing.ts` (never baked into storage). Stored
  `costProds.blankCosts` are fallback-only. `items.blanks_order_cost` =
  ACTUAL paid (separate concept, never touch).
- **One calc engine: `lib/pricing.calcCostProduct`** feeds costing, summary,
  variance, PDFs, portals. `lib/costing-summary.computeCostingSummary` is the
  summary writer; every costing-input mutator must fire
  `/api/jobs/[id]/refresh-financials` or write the summary atomically.
- **`lib/ar.ts` is THE AR spine** (invoices index, god-mode aging): job
  stream + fulfillment stream (shipstation_reports incl. unsent drafts —
  drafts show in lists but stay OUT of money KPIs). Aging is terms-aware;
  close-short waivers (`type_meta.invoice_waived_amount`) settle balances on
  EVERY surface.
- **Never blanket-recompute historical jobs** — old summaries embed the
  decorator rates of their era. Heal targeted, guard on the invariant.
- **QB is the authority on money exchanged.** OpsHub never writes QB to
  "fix" itself. Transport errors must never trigger destructive self-heals
  (see `getCustomerById` — only a definitive not-found may return null).
- `cost_entries.source = 'pre_opshub'` = bills recorded at PO value for
  early jobs billed before AP existed — margin truth only, never pushed to QB.

## Architecture

**Stack**: Next.js 14 App Router · Supabase (Postgres/Auth/RLS, project
`mzkdmvvfqudpzyikafjs`) · typed clients from `lib/supabase/client.ts` /
`server.ts` (they assert around a @supabase/ssr 0.5.1 generics bug — keep the
assertion until that package is upgraded) · Vercel (`app.housepartydistro.com`)
· Browserless (PDFs) · Resend (email; quotes from hello@, POs from
production@, billing@ for AR, creative@ for designers) · Google Drive
(art files; service account, domain-wide delegation) · QuickBooks Online
(invoices/payments/bills; CloudEvents webhook2) · EasyPost (tracking) ·
S&S / AS Colour / LA Apparel / Cotton Collective (blank catalogs) · Shopify
(FOG storefront reads).

**Job detail = `jobs/[id]/JobDetailV2.tsx` ONLY** (classic decommissioned
Sep 5 2026; `page.tsx` is a thin loader). Tabless stage-ordered canvas:
header/money strip → item gallery → item worksheet (Build · Cost · Art) →
Purchasing & Production (blank CC buys + per-vendor POs) → Client block
(quote/proofs/invoice/payment) → Logistics → Activity. Helper-only modules
in the same dir (never rendered as surfaces): `BuySheetTab.jsx` (pickers,
curves, `applyBlankToItem`), `ArtTab.jsx` (`ProofModal`, file cards),
`ProcessingTab.jsx` (`parsePsd`), plus `DecorationPanel.jsx` and
`EditSizesModal.jsx` which V2 renders.

**Main surfaces** (per-user page grants control access — see below):
- `/projects` — the job board (list); job detail lives at `/jobs/[id]`.
  Defaults newest-first; production board owns due-date urgency.
- `/production2`, `/receiving2`, `/shipping2`, `/staging2`, `/distro` — the
  V2 warehouse boards, built on `components/board-kit`. The movement ledger
  (`lib/inventory-ledger`) is the source of truth for shipped/received/
  pulled/forwarded/staged. Legacy `/production`, `/warehouse` etc. linger —
  don't build on them.
- `/invoices` — AR index (money strip tiles filter; Open·History·Closed;
  sortable columns) + `/invoices/fulfillment/*`: the fulfillment invoice
  wizard (client-driven: picker scoped to billed clients, period suggestion,
  ShipStation Shipping Cost CSV, rates prefill from client and save back),
  detail page (state rail Generated→QB→Sent→Paid, QB drift warning), and
  `/bulk` (all-stores CSV → per-client drafts via `shipstation_store_map`;
  Full Service clients lock out; overlap guard prevents double-billing).
- `/billing` (a.k.a. reconciliation) — AP: billing queue (PO expected vs
  billed per job×vendor), bill history, freight, variances. "Mark fully
  billed" on a zero-billed PO records a `pre_opshub` bill at the PO amount.
- `/god-mode` — owner cockpit; consumes lib/ar + costing summaries.
- `/studio` + designer flows — product/design pipeline (art_briefs, design
  work orders, designer magic links). Studio work targets the client hub.
- `/hours` — contractor kiosk (rate-blind); rates + QB bill push in /billing.

**Client-facing = the Client Hub** `/portal/client/[token]` — per-client,
ALL clients enabled (cutover Sep 2 2026; new clients default on;
`client_hub_enabled=false` = dark-launch preview where staff sessions still
see it but the bare link 404s — that asymmetry has burned us, check the flag
when a client reports "invalid link"). Tabs per `portal_features` tiers
(standard = Home/Orders/Catalog; pipeline/studio/releases for FOG-class
clients). The legacy per-job portal `/portal/[token]` still serves old
links; the vendor portal is `/portal/vendor/[token]`. Item status labels
come from `lib/portal/client-phase.ts` — In production → Shipping → Shipped
(drop-ship/ship-through) / In stock → Entered in webstore (stage route).
Client emails route to the hub automatically via `getPortalUrl`.

**Access control**: per-user page grants (`profiles.page_access` +
`lib/access.ts PAGE_CATALOG`), enforced in middleware. **Every new
`(dashboard)` page MUST be catalogued — uncatalogued paths FAIL OPEN.**
Matrix in `opshub-access-map.csv`; seed via `scripts/seed-page-access.cjs`.

**Job lifecycle**: `jobs.phase` (intake → pending → ready → production →
receiving → fulfillment → complete, + on_hold/cancelled) is derived —
`lib/job-phase-recalc` is the canonical recompute; the health cron tripwires
drift. Items carry `pipeline_stage` + the ledger drives warehouse state.
Shipping routes per item/job: `drop_ship`, `ship_through`, `stage`.

## Data model notes

- JSONB heavies: `jobs.costing_data` (pricing config; NO qty copies),
  `jobs.costing_summary` (derived money cache), `jobs.type_meta` (grab-bag:
  QB refs, po_sent_vendors, po_cost_snapshots, waivers, ship meta),
  `items.blank_costs`, `decorators.pricing_data` (fully dynamic rate cards).
- `costing_data._savedAt` is an optimistic lock — every writer must stamp it.
- Migrations are at 170+; `types/database.ts` is generated, never hand-edit.
- Multi-tenant: `company_id` on everything, stamped by DB trigger (mig 059)
  — inserts don't need to set it. RLS scopes by company; god users see all.
- Fulfillment billing lives in `shipstation_reports` (sales / postage /
  combined "Full Service" / fulfillment types; `postage_mode` bulk vs
  per-shipment; `totals.no_billables` marker rows).

## Conventions

- Display names: "Projects" in UI; DB/URLs stay `jobs`. No em-dashes in any
  client-facing copy. Client copy says printing/embroidery, never
  "decoration".
- Inline styles with `lib/theme.ts` `T` tokens on app surfaces (hub uses
  `components/hub/theme` `H`). Never hardcode colors.
- Autosave: debounced, silent, dirty-detection via JSON snapshots; failures
  must surface (red toast via `failed()`), never vanish.
- Decimal inputs: `type="text" inputMode="decimal"`, parse on blur. Percent
  fields take whole numbers ("10"), converted at the boundary.
- Dates: `lib/dates` `parseDay`/`fmtDay` — never bare-parse "YYYY-MM-DD".
- Emails: one consolidated email with a portal/hub link — never per-file
  sends, never surprise attachments (invoice/PO keep their PDFs).
- `window.confirm`/`alert` are banned — `useConfirm` / ConfirmDialog /
  toasts.
- No native binary npm packages (Vercel); don't fight platform limits.
- Uploads go browser→Drive directly (`lib/drive-upload-client`) — API-route
  bodies die silently on big PSDs. `item_files.drive_file_id` is SHARED
  across items — deletes must reference-count (`lib/google-drive-refs`).

## Team

| Person | Works in |
|---|---|
| Jon | Everything (owner/god) |
| Drake | Costing, ordering, production, invoicing |
| Taylor | Job setup, product building, art |
| Goose | Warehouse boards + fulfillment billing (`/invoices`) |
| Abigail | AP/billing |
| Corey | Studio only |
| Dante | Hours |

## Where deeper truth lives

- `DESIGN.md` — the visual/interaction law.
- Session memory (`~/.claude/projects/-Users-jonburrow-opshub/memory/` and
  the user-scope memory) — per-domain doctrine, incident postmortems, locked
  specs, roadmaps. Check it before rediscovering.
- `docs/` — written specs (e.g. `financial-v2-phase1-invoices.md`).
- Parity/verify scripts in `scripts/` — the proof harnesses; prefer running
  one over trusting a summary (including this file).
