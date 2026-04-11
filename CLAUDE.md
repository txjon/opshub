# OpsHub — House Party Distro

Internal operations platform for House Party Distro, a custom apparel company in Las Vegas. Built iteratively — started in Claude.ai, continued in Claude Code. Will also be used by Jon's second company (touring artists/bands) — ~90% feature overlap, same codebase.

## MANDATORY: Before Writing Any Code

DO NOT write code until you have completed these steps. No exceptions.

1. **Read every file you're about to change.** Not grep. Read.
2. **Find every place the affected data is read.** Grep the entire codebase for the field name. List them.
3. **State your plan in plain English before coding.** What changes, what reads it, what needs to update. Get confirmation if the scope is bigger than a UI tweak.
4. **If you're unsure about something, ask.** Don't guess and ship.

## What "done" means

A change is not done when it compiles. It's done when:
- Every surface that displays the affected data shows the correct value
- No stale state exists anywhere (sidebar, header, PDFs, portal, other pages)
- The save path and every read path have been verified

## Don't

- Don't recalculate what's already saved. Read the saved value.
- Don't copy logic into multiple files. One source, one function, import it.
- Don't fix symptoms. Find the actual cause.
- Don't make changes to files you haven't read in this conversation.
- Don't batch multiple independent fixes without verifying each one.

## Pricing Source of Truth

`items.sell_per_unit` is the single source of truth for pricing. It is set by CostingTab (auto-calculated from margin or manually overridden), rounded to the nearest cent, and saved to the items table. Every surface that displays a price — quote PDF, invoice PDF, QB invoice, client portal, sidebar, header KPIs — reads this value. No recalculation. No pricing engine on output surfaces.

## Stack

- **Next.js 14** (App Router, `app/` directory)
- **Supabase** (Postgres, Auth, RLS) — project: `mzkdmvvfqudpzyikafjs.supabase.co`
- **Tailwind CSS** (layout pages) + **inline styles with theme object** (all job detail components)
- **Vercel** (hosting) — deployed at `opshub-umber.vercel.app`
- **Browserless API** for PDF generation (PO + Quote)
- **Resend** for email delivery (quote to client, PO to decorator)
- **S&S Activewear API** for blank catalog integration
- **Google Drive API** for art file storage (service account with domain-wide delegation)
- **QuickBooks Online API** for invoicing, payments, and sales tax (OAuth 2.0 + webhooks)

## Architecture

### Routing

```
app/(dashboard)/
  dashboard/          — KPI dashboard with stuck-in-production detection
  jobs/               — Project list with search, phase filters, item progress counts
  jobs/new/           — New project form with client typeahead + creation modal
  jobs/[id]/          — Project detail (main hub, horizontal pill tabs)
  clients/            — Client list with search (clickable → detail page)
  clients/[id]/       — Client detail (editable info, contacts, project history)
  decorators/         — Decorator list with search + expandable detail + pricing editor
  blank-catalog/      — Manual blank catalog manager
  production/         — Cross-project pipeline board (all items, stats, inline stage advance)
  warehouse/          — Incoming receiving + ship-through + fulfillment
  reports/            — Revenue, margins, turnaround, CSV exports (manager only)
  settings/           — Manager settings (invite/edit team)

app/api/
  auth/signout/       — Sign out handler
  email/send/         — Send quote/PO/invoice PDF via Resend (multi-recipient, types: quote, po, invoice)
  files/              — Art file upload/list/delete/approval (Google Drive)
  pdf/invoice/[jobId]/ — Generate client invoice PDF via Browserless
  pdf/po/[jobId]/     — Generate PO PDF via Browserless
  pdf/quote/[jobId]/  — Generate quote PDF via Browserless
  qb/connect/         — Initiate QuickBooks OAuth flow
  qb/callback/        — Receive OAuth tokens from QB
  qb/invoice/         — Push invoice to QB, return invoice # + payment link + tax
  qb/webhook/         — Receive payment events from QB (HMAC verified)
  ss/                 — S&S Activewear API proxy
  team/               — Invite members + edit roles (manager-only)
```

### Project Detail Page (`jobs/[id]/`)

The central hub. Horizontal pill tabs across the top, content below. 8 tabs ordered to match the actual workflow:

| Tab | Component | Owns |
|---|---|---|
| Overview | Inline in page.tsx | Project info + shipping details (top row), contacts + invoice/payments (left), items + activity stats (right) |
| Buy Sheet | BuySheetTab.jsx | Item creation, size/qty entry, S&S + manual catalog pickers, drag-to-reorder |
| Art Files | ArtTab.jsx | Per-item file upload to Google Drive, stages, proof approval workflow, mockup generator |
| Costing | CostingTab.jsx | Decoration pricing, margin calc, auto-save, share groups |
| Client Quote | CostingTab.jsx (quote sub-tab) | Quote preview + PDF download/email + quote approval + post-approval next-step links |
| Blanks | BlanksTab.jsx | Per-item S&S order # + cost entry with 3-gate checklist |
| Purchase Order | POTab.jsx | PO preview, PDF export/email, per-item fields + copy-to-all, blanks warning, PO sent tracker |
| Production | ProductionTab.jsx | Tracking entry (auto-advances to shipped), per-size shipped quantities, ship notifications |

**Tab order matches workflow**: Taylor sets up (Overview → Buy Sheet → Art Files) → Drake costs and sells (Costing → Client Quote) → Drake orders and sends (Blanks → PO → Production).

**Progress checklist**: Shown at top of every active project (hidden on complete/cancelled). Shows ✓/→/○ for each step: Buy Sheet, Art Files, Costing, Quote Approved, Proofs Approved, Payment, Blanks Ordered, POs Sent, Production. Clicking a step navigates to that tab. Progress bar shows overall percentage.

**Job numbers**: Auto-generated on insert via DB trigger. Format: `HPD-YYMM-NNN` (e.g. HPD-2603-001). Shown on all PDFs (quote, PO, invoice).

**Post-quote-approval flow**: After clicking "Approve Quote", shows "Next: Send Invoice · Send Proofs" links that navigate to the correct tabs.

**Overview layout**: Top row is a 2-column grid (Project info | Shipping details) matched height. Below is another 2-column grid: left (Contacts → Invoice send/preview/download → Payment records → Delete) and right (Items → Activity stats). Phase is read-only with Hold/Resume buttons.

**Blanks tab gates**: 3-gate checklist with ✓/✕ — quote approved, payment received (terms-specific: deposit/prepaid/net), all proofs approved. All must be met before ordering.

**PO tab gates**: Warning if items don't have blanks ordered. Per-vendor PO sent tracker (✓ Sent / — Not sent), auto-recorded when email is sent, persisted in `jobs.type_meta.po_sent_vendors`.

**Art Files — Send Proof**: "Send" button on proof/mockup files emails Drive link to client contacts. Auto-logs to activity.

**Ship notifications**: Team notified via notification bell when tracking is entered on Production tab (warehouse incoming alert).

**Warehouse** is a standalone page (`/warehouse`), not a tab on project detail.

**Standalone Production page** (`/production`): Cross-project pipeline board — all items from all active projects, grouped by stage (In Production, Shipped), with stats, filters, and inline stage advancement.

### Data Flow

**Items** are created in Buy Sheet → art uploaded → enriched in Costing (decoration, pricing) → quote sent/approved → blanks ordered → POs sent to decorators → tracked in Production (in_production → shipped) → received in Warehouse.

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

### Shipping Routes (per job)

Set on Overview tab by Drake during setup. Determines post-decorator flow:

| Route | Meaning |
|---|---|
| `drop_ship` | Decorator ships direct to client, never touches HPD |
| `ship_through` | Comes to HPD, receiver confirms qty, ships right back out to client |
| `stage` | Comes to HPD, stored, fulfillment team ships as a batch later |

Job type (tour/brand/artist/etc.) is independent from route. If items have different destinations, they go in separate jobs.

### Job Lifecycle v2 (Auto-Advancing)

Phase is **read-only** — calculated automatically from item data + proof status + payment status. No manual override (system always wins).

| Phase | Meaning | Calculated when |
|---|---|---|
| `intake` | Setting up | Default, items being added/costed |
| `pending` | Waiting on client | Quote approved but waiting on payment and/or proofs |
| `ready` | Team needs to act | All gates met — order blanks, send POs |
| `production` | At decorator | Any item in_production |
| `receiving` | Coming to HPD | Items shipped from decorator, not all received (ship_through/stage) |
| `fulfillment` | Fulfillment team owns it | All items received at HPD (stage route only) |
| `complete` | Done | All items delivered |
| `on_hold` | Manual lock | Hold button pressed |

**Payment gate by terms:**
- `prepaid` → payment recorded and marked paid
- `deposit_balance` → at least one payment recorded
- `net_15` / `net_30` → auto (quote approval is enough)

**Blanks ordering** (Blanks tab, during ready phase):
- Per-item S&S order # + total cost (compared against calculated blank cost)
- 3-gate checklist: quote approved + payment gate met + all proofs approved
- Blanks progress shown in ready phase display

**Production stages per item** (Production tab):
- `in_production` — item at decorator, printing (default when PO sent)
- `shipped` — auto-set when tracking number is entered (no manual stage buttons)
- Entering tracking is the trigger — no buttons to click

**Routing by shipping route (not job type):**
- `drop_ship`: decorator ships → item complete when tracking assigned
- `ship_through`: decorator ships → HPD receives (confirms qty) → outbound tracking entered on warehouse page → "Mark Shipped" → complete
- `stage`: decorator ships → HPD receives (confirms qty) → fulfillment team (staged → packing → shipped) → complete

**Fulfillment** (stage route, job-level):
- Triggered when all items received at HPD
- Fulfillment team controls: Staged → Packing → Shipped
- Fulfillment tracking field on job
- `fulfillment_status` = "shipped" → project complete

**Phase recalculates on:** quote approval, payment added/status changed, PO sent, production stage advanced, blanks order entered, shipping tracking entered, item received at HPD.

**Hold/Resume:** Manual "Hold" button locks phase. "Resume" clears hold and recalculates.

**Phase timestamps:** Every transition recorded in `jobs.phase_timestamps` JSONB.

**Item progress displayed:** e.g. `Ready · 3/5 blanks ordered` or `Receiving · 2/4 received`

### Warehouse Page (`/warehouse`)

Three sections based on shipping route and item state:

**Incoming**: Items shipped from decorator, not yet received. Shows per-size shipped quantities. Receiver adjusts received quantities per size (defaults to shipped qty). Variance flagged automatically. "Confirm Received" button per item.

**Ship-through**: All items received on ship_through jobs. Shows outbound tracking input + "Mark Shipped" button. Enter tracking → click ship → job moves to complete. Logs activity.

**Fulfillment**: Staged jobs with all items received. Fulfillment team controls: Staged → Packing → Shipped. Outbound tracking field. Auto-logs and notifies on ship.

### Costing Card Layout

Two-column layout: **Blanks panel** (400px, left) + **Decoration panel** (flex, right).

**Blanks panel**: Supplier, Style/Color (read-only from buy sheet), Fleece toggle, collapsible size breakdown grid, item notes, item summary stats (Revenue, Blanks Cost, PO Total, Net Profit, Margin, Profit/Piece).

**Decoration panel**: Vendor selector, print locations table (15%/40%/15%/15%/15% columns), tag print row (same table), finishing & packaging (always visible, 28%/28%/29%/15% columns), setup fees (collapsible), specialty (collapsible, per-item print count), custom costs.

**Finishing & Packaging**: Packaging row has a variant dropdown (from `packaging` keys). Finishing items from `finishing` keys. Fleece upcharge row appears automatically when fleece toggle is on — no separate toggle.

### Client Management

- **Client list** (`/clients`) — clickable names link to detail page
- **Client detail** (`/clients/[id]`) — financial summary strip → client info + contacts (single card, side by side) → history with Projects | Items toggle. Item history groups repeats with count badge, shows all instances across projects. **Reorder button** creates new project pre-filled with item details + client contacts.
- **New project form** — client typeahead (searches as you type), "Create new client" modal with name, type, payment terms, notes, and inline contacts (saved in one action). Includes shipping route selection (drop ship / ship-through / stage).
- **Client types**: corporate, brand, artist, tour, webstore
- **Project types**: tour, webstore, drop_ship

### Contacts & Payments (Job Overview)

- **Contacts**: "+ Add" inline form, find-or-create by email, role on job (primary/billing/creative/logistics/cc), remove per contact
- **Payments**: "+ Add" inline form (type, amount, invoice #, due date), click status badge to cycle (draft→sent→viewed→partial→paid→overdue→void), auto-sets paid_date, delete with confirmation
- **Invoice**: Send Invoice (email with PDF attachment), Preview, Download buttons above payment records. Defaults to billing contact, falls back to primary. Auto-logs send to activity.

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

### Standalone Production Page (`/production`)

Client component — cross-project pipeline board for production team:
- **Stats strip**: items needing blanks ordered, waiting on proofs, stalled 7+ days, shipping this week
- **Grouped by stage**: In Production, Shipped
- **Per-item row**: name, client/project, decorator, units, stage-specific data (proof status / tracking), days in stage, ship date
- **Inline stage buttons**: advance/retreat items without clicking into project (Production tab itself has no buttons — tracking entry is the trigger)
- **Filters**: search, decorator dropdown, stalled-only toggle
- **Sort**: ship date (soonest first), then days in stage (longest first)

### Invoice PDF (`/api/pdf/invoice/[jobId]`)

Client-facing invoice matching PO/quote style:
- HPD logo + address header
- Bill to client (primary contact name + email)
- Info bar: date, terms, ship date, project name
- Line item table: item name, sizes, qty, unit price, total
- Subtotal, paid amount, balance due
- Payment history table
- Preview + Download + Send Invoice buttons on Overview tab above payment records

### Reports Page (`/reports`)

Manager-only reporting dashboard:
- **KPI strip**: total revenue, total cost, avg margin, total units, total paid
- **Revenue by month**: horizontal bar chart with margin % per month
- **Units by month**: monthly volume breakdown
- **Average turnaround**: avg/fastest/slowest days from intake to complete
- **Revenue by client**: table — revenue, cost, margin, units, projects, paid
- **Margins by project**: table sorted by revenue — per-project profitability

**CSV exports** (3 buttons at top of page):
- **Export Projects**: all jobs with job #, client, title, type, phase, revenue, cost, margin, units, paid
- **Export Clients**: aggregated financials per client
- **Export Payments**: all payment records across all projects with job context

### QuickBooks Integration

**Flow:** Create Invoice in QB → get invoice # + payment link + sales tax → generate PDF with QB data → email with "Pay Online" button.

**OAuth:** Connect via `/api/qb/connect`. Tokens stored in `qb_tokens` table. Auto-refreshes on expiry. Auto-retries on 401 (refresh + retry once). Refresh token valid 100 days.

**Invoice push** (`/api/qb/invoice`):
- Matches OpsHub client to QB customer (auto-search by name, cached in `clients.qb_customer_id`)
- Maps `garment_type` → QB Product/Service name (Tees, Hoodies, Hats, etc.)
- Line items: description (name / vendor / color / sizes), qty, rate from `items.sell_per_unit`
- Payment terms carried over
- QB auto-generates invoice number
- After creation, reads invoice back to get sales tax calculation
- Saves to `jobs.type_meta`: qb_invoice_id, qb_invoice_number, qb_payment_link, qb_tax_amount, qb_total_with_tax

**Invoice PDF** shows: QB invoice number, subtotal, sales tax (from QB), paid amount, amount due. Totals match QB exactly (uses rounded `sell_per_unit` from items table).

**Email** includes green "Pay Online" button linking to QB Payments (credit card / ACH). Link generated by sending invoice via QB API with customer email, which triggers QB to create the payment URL.

**Payment link flow:** Invoice created → sent via QB API to customer email → QB generates payment link → OpsHub saves link → included in email and on approvals tab.

**Payment webhook** (`/api/qb/webhook`): Receives QB payment events (HMAC signature verified), matches to job via QB invoice ID, records payment in OpsHub, logs activity, notifies team. Returns 200 always (QB requirement).

**Garment type dropdown** on buy sheet per item — maps to QB Product/Service. 30+ types covering all QB products.

### Handoff Notifications

Every phase transition triggers a team notification via the notification bell:
- → Pending: "Waiting on client (payment/proofs)"
- → Ready: "Ready to order blanks & send POs"
- → Production: "Items at decorator"
- → Receiving: "Items incoming to warehouse"
- → Fulfillment: "All items received — ready for fulfillment"
- → Complete: "Project complete"

Phase transitions also auto-log to job activity feed.

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
| `qb_tokens` | QuickBooks OAuth tokens (one row, auto-refreshed) |

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
014_cleanup_stages.sql     — Map old pipeline stages to new simplified stages
015_shipping_routes.sql    — shipping_route, fulfillment fields on jobs; received_at_hpd, received_qtys on items
016_phase_constraint.sql   — Update phase constraint for v2 lifecycle, map old phases
017_job_number_auto.sql    — Auto-generate job numbers (HPD-YYMM-NNN) via trigger + backfill
018_fix_rls_phases.sql     — Fix RLS policies for production/shipping roles with new phases
019_quickbooks.sql         — qb_tokens table + clients.qb_customer_id
020_garment_types.sql      — Expanded garment_type constraint (30+ types for QB mapping)
```

### JSONB Patterns

- `jobs.costing_data` — full costing state (costProds with share groups, margin, shipping/CC toggles, orderInfo)
- `jobs.costing_summary` — aggregated metrics (grossRev, totalCost, netProfit, margin)
- `jobs.type_meta` — misc metadata (ship dates, venue, shipping stage/notes)
- `items.receiving_data` — warehouse receiving metadata (carrier, tracking, location, condition)
- `items.blank_costs` — per-size blank costs
- `items.pipeline_timestamps` — JSONB recording when each pipeline stage was entered (ISO timestamps keyed by stage id)
- `items.ship_qtys` — per-size quantities shipped from decorator
- `items.received_qtys` — per-size quantities confirmed received at HPD
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

### `lib/quickbooks.ts`
QuickBooks Online API client. OAuth token management (save, refresh, auto-retry on 401). Customer search/create with caching. Invoice creation with product mapping, tax readback, and payment link generation. All API calls log `intuit_tid` for debugging.

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
Notification dropdown in sidebar header. Shows unread count badge, click to expand. Polls every 15s. Click notification to jump to referenced job. Supports @mention, alert, approval, payment, production notification types.

### `components/JobActivityPanel.tsx`
Job-level activity feed component + auto-logging helpers:
- `logJobActivity(jobId, message)` — logs auto events to `job_activity` table. Called from: quote sent/approved, PO sent, invoice sent, proof/mockup sent to client, payment added/status changed, stage advanced, files uploaded, blanks ordered, shipping tracked.
- `notifyTeam(message, type, referenceId, referenceType)` — broadcasts notification to all team members. Called on: quote approved, payment received, items shipped from decorator (warehouse incoming).
- `JobActivityPanel` component — embeddable feed (used on Overview tab as static stats, full feed available).

### `components/GlobalSearch.tsx`
Global search modal. Triggered by search bar in sidebar or Cmd+K. Searches across projects (title, job number, client name), clients (name), decorators (name, short code), and items (name). 200ms debounce, keyboard navigation (↑↓ Enter Esc), color-coded result types.

### `components/ProjectProgress.tsx`
Progress checklist bar shown at top of every active project. Shows completion state of each workflow step. Clicking a step navigates to the corresponding tab. Calculates from: items, costing, quote_approved, proof status, payments, blanks_order_number, PO sent vendors.

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
QB_CLIENT_ID                       — QuickBooks OAuth client ID
QB_CLIENT_SECRET                   — QuickBooks OAuth client secret
QB_REALM_ID                        — QuickBooks company ID
QB_REDIRECT_URI                    — OAuth callback URL
QB_WEBHOOK_VERIFIER_TOKEN          — HMAC verification for QB webhooks
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

### Deferred automation
- Auto-generate invoice numbers — format TBD
- Size curve memory — remember last distribution curve per client/project type
- Scheduled notifications for overdue payments + stalled items (needs background jobs)

### Deferred features
- Client item catalog — searchable library per client for reordering
- Client communication trail (log emails sent to project activity)
- Decorator portal / two-way status updates
- Dashboard action buttons (beyond phase-transition notifications)
- Multi-file drag-and-drop upload for Art Files tab
- AS Colour blank catalog CSV import
- Templates — save/load project templates for repeat clients

### Structural / technical
- **Permissions refactor planned**: Role-based access enforcement (not just nav hiding) — blocked on Jon's team meeting
- No decoration type selector (defaults to screen_print) — could pull from decorator capabilities
- Pricing logic duplicated in CostingTab, PO route, and Quote route — working but not DRY
- Old `receiving_data` JSONB on items is superseded by `received_at_hpd` + `received_qtys` — can be cleaned up
- POTab NoteBox has a few hardcoded colors (#f9f9f9, #bbb) — cosmetic, should use T theme

### Codebase health (audited 2026-03-27)
- **Types**: `types/database.ts` updated to match all migrations (001-018)
- **No stale references**: all phase/stage values match v2 lifecycle
- **No broken imports**: all imports resolve
- **No dead imports**: all imports used
- **No console.log**: production code is clean
- **Theme compliance**: all colors use T object (except POTab NoteBox)
- **Build**: compiles with zero errors

## Roadmap

**Current: Week 1 — Go live** with real projects. Taylor (setup/art) and Drake (costing/ordering/production) start using it. Collect feedback.

**Week 2**: Fix everything from Week 1 feedback.

**Week 3**: QuickBooks integration — push invoices and payments to QB via API. OpsHub owns invoicing/AR, QB owns bookkeeping/expenses/tax.

**Week 4**: Client-facing features — proof approval via magic links (no login), Stripe payment links on invoices.

**Future**: God Mode (owner dashboard), permissions refactor, templates, decorator portal, multi-company support, scheduled notifications.

## Team Roles

| Person | Role | Primary Pages |
|---|---|---|
| **Jon** | Owner/operator, hands-on + oversight | Dashboard, Projects, Reports, Clients, Settings, everything |
| **Taylor** | Project setup & design | Projects list → Overview, Buy Sheet, Art Files |
| **Drake** | Pricing, ordering & production | Costing, Client Quote, Blanks, PO, Production page |
| **Receiver** | Warehouse receiving (1 dedicated person) | Warehouse — incoming section |
| **Fulfillment** | Packing & shipping | Warehouse — fulfillment section |

Taylor picks up projects from the list (not assigned). Taylor and Drake work together on every job initially. Receiver only confirms quantities — routing is set by Drake during project setup.

## Multi-Company

Jon has a second company (touring artists/bands). Same decorators, same blank suppliers, different team, different clients, different pricing/invoicing. Touring company uses HPD as a vendor for warehousing and fulfillment.

**Architecture**: Two separate OpsHub deployments (same code, different DB). Only crossover is warehouse — touring company creates fulfillment requests that appear on HPD's warehouse page via API handoff.

**God Mode**: Future owner dashboard for Jon — financial (revenue, margins, AR aging, cash flow) + operational (capacity, bottlenecks, team workload, timelines). Everything an owner-operator needs to make decisions, all in one view.

## Owner

Jon Burrow — not a developer. Keep changes surgical, test before committing, explain what changed.
