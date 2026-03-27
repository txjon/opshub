# OpsHub — House Party Distro

Internal operations platform for House Party Distro, a custom apparel company in Las Vegas. Built iteratively — started in Claude.ai, continued in Claude Code.

## Stack

- **Next.js 14** (App Router, `app/` directory)
- **Supabase** (Postgres, Auth, RLS) — project: `mzkdmvvfqudpzyikafjs.supabase.co`
- **Tailwind CSS** (layout pages) + **inline styles with theme object** (all job detail components)
- **Vercel** (hosting) — deployed at `opshub-umber.vercel.app`
- **Browserless API** for PDF generation (PO + Quote)
- **Resend** for email delivery (quote to client, PO to decorator)
- **S&S Activewear API** for blank catalog integration
- **Google Drive API** for art file storage (service account with domain-wide delegation)

## Architecture

### Routing

```
app/(dashboard)/
  dashboard/          — KPI dashboard with stuck-in-production detection
  jobs/               — Project list with search + phase filters
  jobs/new/           — New project form with client typeahead + creation modal
  jobs/[id]/          — Project detail (main hub, vertical tab nav)
  clients/            — Client list (clickable → detail page)
  clients/[id]/       — Client detail (editable info, contacts, project history)
  decorators/         — Decorator list with expandable detail + pricing editor
  blank-catalog/      — Manual blank catalog manager
  production/         — Standalone production view
  receiving/          — Standalone receiving view
  shipping/           — Standalone shipping view
  templates/          — Job templates
  settings/           — Manager settings

app/api/
  auth/signout/       — Sign out handler
  email/send/         — Send quote/PO PDF via Resend (multi-recipient)
  files/              — Art file upload/list/delete/approval (Google Drive)
  pdf/po/[jobId]/     — Generate PO PDF via Browserless
  pdf/quote/[jobId]/  — Generate quote PDF via Browserless
  ss/                 — S&S Activewear API proxy
  team/               — Invite members + edit roles (manager-only)
```

### Project Detail Page (`jobs/[id]/`)

The central hub. Horizontal pill tabs across the top, content below. 7 tabs, each its own component:

| Tab | Component | Owns |
|---|---|---|
| Overview | Inline in page.tsx | Project info + shipping details (top row), contacts + payments (left), items + activity stats (right) |
| Buy Sheet | BuySheetTab.jsx | Item creation, size/qty entry, S&S + manual catalog pickers, drag-to-reorder |
| Art Files | ArtTab.jsx | Per-item file upload to Google Drive, stages, proof approval workflow, mockup generator |
| Costing | CostingTab.jsx | Decoration pricing, margin calc, auto-save, share groups |
| Client Quote | CostingTab.jsx (quote sub-tab) | Quote preview + PDF download/email + quote approval button |
| Purchase Order | POTab.jsx | PO preview, PDF export/email, per-item drive link + production notes + copy-to-all |
| Production | ProductionTab.jsx | 3-stage pipeline (blanks ordered → in production → shipped), blanks order tracking, shipping data entry |

**Overview layout**: Top row is a 2-column grid (Project info | Shipping details) matched height. Below is another 2-column grid: left (Contacts → Payment records → Delete) and right (Items → Activity stats). Phase is read-only with Hold/Resume buttons.

**Warehouse** is a standalone page (`/warehouse`), not a tab on project detail.

**Note**: Standalone Production page rebuild is planned — cross-project pipeline board for production team.

### Data Flow

**Items** are created in Buy Sheet → enriched in Costing (decoration, pricing) → tracked in Production (pipeline stages) → received in Warehouse.

**Key ownership rules (enforced in code):**
- **Client name, ship date, notes** — owned by the job record (Overview tab). Quote reads from `project` props, not separate copies.
- **Item name, sizes, quantities** — owned by Buy Sheet. Costing syncs from `buyItems` prop via snapshot comparison (prevents re-render loops).
- **Style/Color** — owned by Buy Sheet, displayed as read-only text in Costing (not editable inputs).
- **Blank costs** — initial source is Buy Sheet (from catalog). Costing can refine per-size costs, writes back to `items.blank_costs` on save. Job-scoped only — does not affect the blank catalog.
- **Decorator pricing** — owned by the `decorators.pricing_data` JSONB column. CostingTab, PO route, and Quote route all load from DB on each render/request.
- **Pipeline stage** — saved on `items.pipeline_stage` (primary) and synced to `decorator_assignments` if one exists.
- **Decorator assignment** — auto-created/updated when costing saves, by mapping `printVendor` → `decorator_id`.

### Auto-Save Pattern

Used in Buy Sheet, Costing, Warehouse tabs, and Decorators page:
1. Local state tracks edits
2. Dirty detection via JSON snapshot comparison (prevents false triggers from re-renders)
3. **800ms debounced save** after any change (1500ms for Buy Sheet to allow fast tabbing)
4. `onSaveRef` for stable function reference across renders
5. `onRegisterSave` callback so parent can force-save on tab switch
6. **Silent saves** — no visible indicator. Only shows red error toast if save fails.
7. `beforeunload` guard warns if closing with unsaved changes

**Important**: The CostingTabWrapper has a single buyItems sync effect that updates BOTH `costProds` and `savedCostProds` to prevent dirty-detection loops. The inner CostingTab does NOT have its own sync effect — it was removed to prevent the two from fighting.

**Buy Sheet save behavior**: `doSave()` does NOT overwrite `localItems` after saving — it only updates `savedSnapshot`. This prevents saves from resetting values the user is actively typing. The only exception is when new items get real DB IDs (temp → UUID swap).

### Decorator Pricing

Pricing lives in `decorators.pricing_data` (JSONB):
```
{
  qtys: [48, 72, 144, ...],           // Quantity tiers
  prices: { 1: [...], 2: [...] },     // Per-color-count prices at each tier
  tagPrices: [...],                    // Tag print prices at each tier
  minimums: { print: 150, tagPrint: 75 }, // Min charge when qty < first tier
  packaging: { Tee: 0.55, ... },      // Packaging variant rates (dropdown in costing)
  finishing: { HangTag: 0.25, ... },   // Finishing per-unit rates
  setup: { Screens: 20, ... },         // Setup fee per-unit rates
  specialty: { Puff: 0.50, ... },      // Specialty per-unit upcosts
}
```

All sections (packaging, finishing, setup, specialty) are **fully dynamic** — add/rename/delete categories per decorator on the Decorators page, they show up in Costing automatically. No hardcoded option names anywhere.

**Minimum charge pricing**: When item qty is below the decorator's first tier, the per-unit rate = `minimum / qty` (applied per print location for print, flat for tag). Setup fees still apply on top.

**Special setup fee behaviors:**
- "Screens" and "Tag Screens" (matched case-insensitively, with or without spaces) are auto-calculated from print locations
- Setup fees whose name contains an active specialty name auto-link to that specialty's print count (e.g. "Puff Screen Up Charge" reads from Puff's count)

**Specialty items** have an editable print count (defaults to total active locations, can be set lower). This count drives both the per-unit specialty rate and any linked setup fees.

### Share Groups (Print Location Sharing)

When items share a print location (same art, same position), use share groups:
1. Click "Share" on a print location → type a group name (e.g. "A")
2. All items with the same group name → **combined qty** for rate lookup
3. **Screen fees** → charged only on the **first item** in the group
4. Multiple groups are independent (Group A ≠ Group B)

Share groups are stored as `shareGroup` on each print location in `costProd.printLocations[loc]`. Logic is applied in CostingTab, PO route, and Quote route.

### Art Files & Google Drive Integration

Per-item file management with automatic Google Drive sync. Files upload from OpsHub directly to Drive.

**Folder structure**: `OpsHub Files / {Client Name} / {Project Title} / {Item Name} /`

**File stages** (in order):
1. `client_art` — Original art from client
2. `vector` — Cleaned up vectors
3. `mockup` — Visual mockup (sent with quote)
4. `proof` — Print proof (requires client approval)
5. `print_ready` — Final file for decorator

**Proof approval workflow**: Proofs auto-get `pending` status. Can be marked `approved` or `revision_requested`. Re-submittable after revision.

**Print-ready auto-link**: When a `print_ready` file is uploaded, the item's `drive_link` is automatically updated — this is the link that appears on PO PDFs.

**Google Drive auth**: Service account (`opshub-drive@opshub-491306.iam.gserviceaccount.com`) with domain-wide delegation, impersonating `jon@housepartydistro.com`. Key stored as `GOOGLE_SERVICE_ACCOUNT_KEY` (JSON) or `GOOGLE_SERVICE_ACCOUNT_KEY_B64` (base64).

**API route**: `/api/files` — POST (upload), GET (list by itemId), DELETE, PATCH (approval status).

### PO Tab Item Fields

Each item on the PO tab has four editable fields (save on blur to items table):
- **Production files link** (`drive_link`) — auto-populated by print-ready upload, also manual
- **Incoming goods** (`incoming_goods`) — notes about blanks arriving
- **Production notes** (`production_notes_po`) — special instructions for decorator
- **Packing / shipping notes** (`packing_notes`) — shipping instructions

**Ship method**: Hardcoded list (UPS, FedEx, USPS, Freight, Will Call, Decorator Drop Ship). No database table.

### Job Lifecycle (Auto-Advancing)

Phase is **read-only** — calculated automatically from item data. No manual override (system always wins).

| Phase | Trigger |
|---|---|
| `intake` | Project created (default) |
| `pre_production` | Quote approved + payment gate met |
| `production` | First blanks ordered OR first PO sent |
| `receiving` | First item tracking entered (warehouse jobs only) |
| `shipped` | First item tracking entered (drop ship) OR shipped from warehouse |
| `complete` | All items shipped/delivered |

**Payment gate by terms:**
- `prepaid` → full payment recorded and marked paid
- `deposit_balance` → at least one payment recorded
- `net_15` / `net_30` → auto (quote approval is enough)

**Production stages per item** (simplified from original 6 to 3):
1. `blanks_ordered` — S&S order # + total cost (compared against calculated cost)
2. `in_production` — decorator is printing (art approval gate shows warnings)
3. `shipped` — tracking # + per-size shipped quantities entered

**Routing by job type:**
- Warehouse jobs (tour, webstore, corporate, brand, artist): shipped → warehouse receiving → ship to client → complete
- Drop ship: shipped → complete (decorator ships direct to client)

**Phase recalculates on:** quote approval, payment added/status changed, PO sent, production stage advanced, blanks order entered, shipping tracking entered.

**Hold/Resume:** Manual "Hold" button locks phase. "Resume" clears hold and recalculates to correct phase.

**Phase timestamps:** Every transition recorded in `jobs.phase_timestamps` JSONB.

**Item progress displayed:** e.g. `Production · 3/5 items in production`

**Backwards allowed:** If items regress, phase recalculates backwards.

### Costing Card Layout

Two-column layout: **Blanks panel** (400px, left) + **Decoration panel** (flex, right).

**Blanks panel**: Supplier, Style/Color (read-only from buy sheet), Fleece toggle, collapsible size breakdown grid, item notes, item summary stats (Revenue, Blanks Cost, PO Total, Net Profit, Margin, Profit/Piece).

**Decoration panel**: Vendor selector, print locations table (15%/40%/15%/15%/15% columns), tag print row (same table), finishing & packaging (always visible, 28%/28%/29%/15% columns), setup fees (collapsible), specialty (collapsible, per-item print count), custom costs.

**Finishing & Packaging**: Packaging row has a variant dropdown (from `packaging` keys). Finishing items from `finishing` keys. Fleece upcharge row appears automatically when fleece toggle is on — no separate toggle.

### Client Management

- **Client list** (`/clients`) — clickable names link to detail page
- **Client detail** (`/clients/[id]`) — editable info (name, type, terms, notes), contacts CRUD, project history with revenue/units/phase
- **New project form** — client typeahead (searches as you type), "Create new client" modal with name, type, payment terms, notes, and inline contacts (saved in one action)
- **Client types**: corporate, brand, artist, tour, webstore
- **Project types**: tour, webstore, drop_ship

### Contacts & Payments (Job Overview)

- **Contacts**: "+ Add" inline form, find-or-create by email, role on job (primary/billing/creative/logistics/cc), remove per contact
- **Payments**: "+ Add" inline form (type, amount, invoice #, due date), click status badge to cycle (draft→sent→viewed→partial→paid→overdue→void), auto-sets paid_date, delete with confirmation

### Decorator Management

- **Expandable cards** with company info, multiple contacts (JSONB array), ship-to address, ship-from address (toggle for different pickup location), notes
- **Pricing editor**: qty tier grid with keyboard nav (Tab/Enter/arrows), packaging/finishing/setup/specialty sections with add/rename/delete on categories, minimum charge fields
- **Multi-contact PO sending**: email dialog shows checkboxes for all decorator contacts, all selected by default, with option to deselect

### Dashboard

Server component showing:
- KPI row: active revenue, avg margin, units in pipeline, outstanding payments, shipping this week
- Needs action: overdue projects, overdue payments, pre-production items, **stalled production** (items with no stage change in 7+ days)
- Production pipeline phase breakdown
- Shipping this week
- Finance summary
- All active projects list

## Database

### Key Tables

| Table | Purpose |
|---|---|
| `jobs` | Core project record + `costing_data`/`costing_summary` JSONB |
| `items` | Line items per job (name, vendor, SKU, costs, `pipeline_stage`, `receiving_data`) |
| `buy_sheet_lines` | Per-size quantities with multi-stage tracking |
| `clients` | Client records (name, type: corporate/brand/artist, terms, notes) |
| `contacts` | Contacts linked to clients |
| `job_contacts` | Links contacts to jobs with roles |
| `decorators` | Decorator records with `pricing_data`, `contacts_list` JSONB, dual addresses, `short_code` |
| `decorator_assignments` | Links items to decorators with pipeline stage |
| `payment_records` | Invoice/payment tracking per job |
| `blank_catalog` | User-maintained blank garment catalog |
| `item_files` | Art file metadata per item (actual files in Google Drive) |
| `job_activity` | Per-job activity feed (auto events + manual comments) |
| `messages` | Party Line global team chat |
| `notifications` | Per-user notifications (@mentions, alerts) |

### Migrations

```
001_initial_schema.sql    — Core tables
002_rls.sql               — Row-level security policies
003_warehouse_data.sql    — items.receiving_data column
004_item_pipeline_stage.sql — items.pipeline_stage column
005_decorator_details.sql — Decorator address, ship-from, pricing_data columns
006_decorator_contacts.sql — decorators.contacts_list JSONB
007_update_job_types.sql  — Updated job_type + client_type constraints
008_item_files.sql        — item_files table for art file metadata
009_client_types.sql      — Added tour + webstore client types
010_pipeline_timestamps.sql — items.pipeline_timestamps JSONB column
011_job_type_artist.sql    — Added artist to job_type constraint
012_messaging.sql          — job_activity, messages, notifications tables
013_lifecycle.sql          — Blanks order fields, shipping fields, phase timestamps, quote approval on jobs
```

### JSONB Patterns

- `jobs.costing_data` — full costing state (costProds with share groups, margin, shipping/CC toggles, orderInfo)
- `jobs.costing_summary` — aggregated metrics (grossRev, totalCost, netProfit, margin)
- `jobs.type_meta` — misc metadata (ship dates, venue, shipping stage/notes)
- `items.receiving_data` — warehouse receiving metadata (carrier, tracking, location, condition)
- `items.blank_costs` — per-size blank costs
- `items.pipeline_timestamps` — JSONB recording when each pipeline stage was entered (ISO timestamps keyed by stage id)
- `decorators.pricing_data` — full pricing structure with minimums (see Decorator Pricing above)
- `decorators.contacts_list` — array of {name, email, phone, role}

## Shared Code

### `lib/theme.ts`
Single source for colors, fonts, size ordering. Used everywhere via `import { T, font, mono, SIZE_ORDER, sortSizes } from "@/lib/theme"`.

**Do not hardcode color values** — always use `T.text`, `T.muted`, `T.card`, etc. Theme was tuned for contrast: `muted` (#8a92b0), `faint` (#515a78), `surface` (#1a1f2e), `border` (#313a56).

### `lib/supabase/client.ts` / `server.ts`
Shared Supabase clients. Use `createClient()` from the appropriate one — never instantiate directly.

### `lib/lifecycle.ts`
Phase calculation engine. `calculatePhase()` takes job, items, payments, and costing data → returns the correct phase and item progress string. Called from job detail page on every relevant change. Supports payment gate logic, job type routing (warehouse vs drop ship), and hold/cancelled locks.

### `lib/google-drive.ts`
Google Drive API wrapper. Handles folder creation, file upload, deletion, and permissions. Uses service account with domain-wide delegation. Supports both `GOOGLE_SERVICE_ACCOUNT_KEY` (raw JSON) and `GOOGLE_SERVICE_ACCOUNT_KEY_B64` (base64) env var formats.

### `components/SendEmailDialog.jsx`
Reusable email dialog. Supports single recipient (quote to client) or multi-recipient with checkboxes (PO to decorator contacts, all selected by default).

### `components/ConfirmDialog.tsx`
Styled confirmation modal (replaces browser `confirm()`). Dark themed, Escape to close, click backdrop to close. Used across decorators, blank catalog, client detail, and job detail pages.

### `components/Skeleton.tsx`
Loading skeleton components with shimmer animation. `Skeleton` (single bar), `SkeletonRows` (card-style rows), `SkeletonTable` (table placeholder). Used on job detail and client detail pages for initial load only.

### `components/PartyLine.tsx`
Floating global team chat. Bottom-right button accessible from every page. Messages stored in `messages` table, polls every 5s. Rendered via `DashboardShell` in the dashboard layout.

### `components/NotificationBell.tsx`
Notification dropdown (built, not yet wired into sidebar). Shows unread count, click to expand. Supports @mention, alert, approval, payment, production notification types.

### `components/JobActivityPanel.tsx`
Job-level activity feed component. Currently not used in the UI (Overview shows static stats instead). Exports `logJobActivity()` helper for auto-logging events from other components. Can be re-enabled when auto-logging is wired up.

### `scripts/verify-costing.js`
CLI tool to verify costing math. Run `node scripts/verify-costing.js` to list jobs, `node scripts/verify-costing.js <jobId>` for full calculation breakdown of every item — compare against Excel.

## Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SS_USERNAME / SS_PASSWORD          — S&S Activewear API
BROWSERLESS_API_KEY                — PDF generation
RESEND_API_KEY                     — Email delivery
EMAIL_FROM_QUOTES                  — hello@housepartydistro.com
EMAIL_FROM_PO                      — production@housepartydistro.com
GOOGLE_SERVICE_ACCOUNT_KEY         — Google service account JSON (Vercel)
GOOGLE_SERVICE_ACCOUNT_KEY_B64     — Same key, base64-encoded (local dev)
GOOGLE_DRIVE_ROOT_FOLDER_ID        — Root "OpsHub Files" folder in Drive
```

## Conventions

- **Display names**: "Projects" (not "Jobs") in all UI. DB tables/URLs stay as `jobs`.
- **Project types**: corporate, brand, artist, tour, webstore, drop_ship (aligned with client types)
- **Client types**: corporate, brand, artist, tour, webstore
- **Job type defaults from client type** when creating a new project
- **Auto-save**: 800ms debounce (1500ms for Buy Sheet), silent (no visible indicator unless error)
- **Inline styles**: Job detail components use inline styles with the `T` theme object. Layout pages (clients list, new project) use Tailwind.
- **No hardcoded pricing or options**: All decorator rates and option names come from `decorators.pricing_data`.
- **Decimal inputs**: Use `type="text" inputMode="decimal"` with local string state to avoid parseFloat eating trailing dots. Parse on blur/commit, not on every keystroke.
- **Numeric inputs**: Auto-select on focus so typing overwrites the existing value.
- **Date fields**: Use `type="date"` for native calendar picker.
- **Dirty detection**: Use JSON snapshot comparison with refs to prevent re-render loops. Never have two competing sync effects for the same data.

### API Auth Pattern

- **Browser requests**: Authenticated via Supabase cookie session (`createClient` from `lib/supabase/server`)
- **Internal server-to-server** (email → PDF): Uses `x-internal-key` header with `SUPABASE_SERVICE_ROLE_KEY`
- **Google Drive**: Service account with domain-wide delegation impersonating `jon@housepartydistro.com`

### Automation & Workflow Helpers

- **Client defaults on new project**: Selecting a client auto-fills payment terms from `clients.default_terms` and auto-adds all client contacts to the job (primary gets "primary" role, others get "cc")
- **Print location presets**: Location name inputs show a datalist dropdown with common names (Front, Back, Left Sleeve, Right Sleeve, Left Chest, Right Chest, Neck, Hood, Pocket) — still accepts free text
- **PO "Copy to all"**: Each PO item field shows "↓ Copy to all" when it has a value and multiple items exist for the current vendor
- **Contact deduplication**: Adding a contact with an email already on the job shows a warning
- **In-hands date auto-calc**: Setting ship date auto-suggests in-hands = ship date + 3 days (only when in-hands is empty)
- **Receiving qty mismatch**: Red alert banner at top of warehouse tab when any item's received qty < ordered qty
- **Duplicate project**: Button in job detail header copies the job, all items + buy sheet lines, costing data (with remapped IDs), and contacts
- **Pipeline stage timestamps**: Records ISO timestamp when each stage is entered, displays "Xd in stage" per item (amber at 3+ days, red at 7+)
- **Art → Production gate**: At strike-off stage, shows warning if proofs aren't uploaded/approved, confirmation when all approved

### Settings & Team Management

- **Manager-only access**: Server-side role check redirects non-managers
- **Invite members**: POST to `/api/team` with email, name, role → Supabase admin invite
- **Edit roles**: Click role in table → dropdown (viewer/staff/manager) → PATCH to `/api/team`
- **Can't edit own role** (prevents lockout)

## Known Issues / Future Work

### Next up (queued for next session)
1. Projects list — show phase progress counts (e.g. "Production · 3/5 items")
2. Standalone Production page rebuild — cross-project pipeline board
3. Auto-log events to job_activity (PO sent, quote approved, payment, stage change, file upload)
4. Invoice PDF generation — deposit, balance, full payment with line items
5. Notification bell wired into sidebar

### Deferred
- Auto-generate invoice numbers — format TBD
- Size curve memory — remember last distribution curve per client/project type (needs cross-project tracking)
- Client item catalog — searchable library per client for reordering
- Multi-file drag-and-drop upload for Art Files tab (on hold)
- AS Colour blank catalog CSV import — pricing file ready, import script not yet built

### Structural / technical
- **Permissions refactor planned**: Role-based access enforcement (not just nav hiding) — blocked on Jon's team meeting
- Standalone Receiving (`/receiving`) and Shipping (`/shipping`) pages removed from sidebar (replaced by `/warehouse`)
- No decoration type selector (defaults to screen_print) — could pull from decorator capabilities
- Templates page "Use template" button is not wired up
- Pricing logic duplicated in CostingTab, PO route, and Quote route — working but not DRY

### Future features
- Client communication trail (log emails sent to project activity)
- Decorator portal / two-way status updates
- Client financial summary across projects
- Dashboard action buttons (not just passive alerts)

## Owner

Jon Burrow — not a developer. Keep changes surgical, test before committing, explain what changed.
