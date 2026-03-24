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
  pdf/po/[jobId]/     — Generate PO PDF via Browserless
  pdf/quote/[jobId]/  — Generate quote PDF via Browserless
  ss/                 — S&S Activewear API proxy
```

### Project Detail Page (`jobs/[id]/`)

The central hub. Vertical tab nav on the left, content on the right. 7 tabs, each its own component:

| Tab | Component | Owns |
|---|---|---|
| Overview | Inline in page.tsx | Project info, contacts CRUD, payments CRUD, shipping details, items summary |
| Buy Sheet | BuySheetTab.jsx | Item creation, size/qty entry, S&S + manual catalog pickers, drag-to-reorder |
| Costing | CostingTab.jsx | Decoration pricing, margin calc, auto-save, share groups |
| Client Quote | CostingTab.jsx (quote sub-tab) | Quote preview + PDF download/email |
| Purchase Order | POTab.jsx | PO preview, PDF export/email to multiple decorator contacts, packing notes |
| Production | ProductionTab.jsx | Pipeline stage tracking per item |
| Warehouse | WarehouseTab.jsx | Receiving (carrier, tracking, per-size qtys) + shipping fulfillment |

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
3. **800ms debounced save** after any change
4. `onSaveRef` for stable function reference across renders
5. `onRegisterSave` callback so parent can force-save on tab switch
6. **Silent saves** — no visible indicator. Only shows red error toast if save fails.
7. `beforeunload` guard warns if closing with unsaved changes

**Important**: The CostingTabWrapper has a single buyItems sync effect that updates BOTH `costProds` and `savedCostProds` to prevent dirty-detection loops. The inner CostingTab does NOT have its own sync effect — it was removed to prevent the two from fighting.

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

### Costing Card Layout

Two-column layout: **Blanks panel** (400px, left) + **Decoration panel** (flex, right).

**Blanks panel**: Supplier, Style/Color (read-only from buy sheet), Fleece toggle, collapsible size breakdown grid, item notes, item summary stats (Revenue, Blanks Cost, PO Total, Net Profit, Margin, Profit/Piece).

**Decoration panel**: Vendor selector, print locations table (15%/40%/15%/15%/15% columns), tag print row (same table), finishing & packaging (always visible, 28%/28%/29%/15% columns), setup fees (collapsible), specialty (collapsible, per-item print count), custom costs.

**Finishing & Packaging**: Packaging row has a variant dropdown (from `packaging` keys). Finishing items from `finishing` keys. Fleece upcharge row appears automatically when fleece toggle is on — no separate toggle.

### Client Management

- **Client list** (`/clients`) — clickable names link to detail page
- **Client detail** (`/clients/[id]`) — editable info (name, type, terms, notes), contacts CRUD, project history with revenue/units/phase
- **New project form** — client typeahead (searches as you type), "Create new client" modal with name, type, payment terms, notes, and inline contacts (saved in one action)
- **Client types**: corporate, brand, artist
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

### Migrations

```
001_initial_schema.sql    — Core tables
002_rls.sql               — Row-level security policies
003_warehouse_data.sql    — items.receiving_data column
004_item_pipeline_stage.sql — items.pipeline_stage column
005_decorator_details.sql — Decorator address, ship-from, pricing_data columns
006_decorator_contacts.sql — decorators.contacts_list JSONB
007_update_job_types.sql  — Updated job_type + client_type constraints
```

### JSONB Patterns

- `jobs.costing_data` — full costing state (costProds with share groups, margin, shipping/CC toggles, orderInfo)
- `jobs.costing_summary` — aggregated metrics (grossRev, totalCost, netProfit, margin)
- `jobs.type_meta` — misc metadata (ship dates, venue, shipping stage/notes)
- `items.receiving_data` — warehouse receiving metadata (carrier, tracking, location, condition)
- `items.blank_costs` — per-size blank costs
- `decorators.pricing_data` — full pricing structure with minimums (see Decorator Pricing above)
- `decorators.contacts_list` — array of {name, email, phone, role}

## Shared Code

### `lib/theme.ts`
Single source for colors, fonts, size ordering. Used everywhere via `import { T, font, mono, SIZE_ORDER, sortSizes } from "@/lib/theme"`.

**Do not hardcode color values** — always use `T.text`, `T.muted`, `T.card`, etc. Theme was tuned for contrast: `muted` (#8a92b0), `faint` (#515a78), `surface` (#1a1f2e), `border` (#313a56).

### `lib/supabase/client.ts` / `server.ts`
Shared Supabase clients. Use `createClient()` from the appropriate one — never instantiate directly.

### `components/SendEmailDialog.jsx`
Reusable email dialog. Supports single recipient (quote to client) or multi-recipient with checkboxes (PO to decorator contacts, all selected by default).

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
```

## Conventions

- **Display names**: "Projects" (not "Jobs") in all UI. DB tables/URLs stay as `jobs`.
- **Project types**: tour, webstore, drop_ship
- **Client types**: corporate, brand, artist
- **Auto-save**: 800ms debounce, silent (no visible indicator unless error)
- **Inline styles**: Job detail components use inline styles with the `T` theme object. Layout pages (clients list, new project) use Tailwind.
- **No hardcoded pricing or options**: All decorator rates and option names come from `decorators.pricing_data`. The `FALLBACK_PRINTERS` in CostingTab exists only as migration scaffolding and can be removed.
- **Decimal inputs**: Use `type="text" inputMode="decimal"` with local string state to avoid parseFloat eating trailing dots. Parse on blur/commit, not on every keystroke.
- **Numeric inputs**: Auto-select on focus so typing overwrites the existing value.
- **Date fields**: Use `type="date"` for native calendar picker.
- **Dirty detection**: Use JSON snapshot comparison with refs to prevent re-render loops. Never have two competing sync effects for the same data.

## Known Issues / Future Work

- `FALLBACK_PRINTERS` in CostingTab and `legacy-pricing.ts` can be removed (all pricing in DB now)
- Standalone Receiving (`/receiving`) and Shipping (`/shipping`) pages may be stale after warehouse tab changes
- No decoration type selector (defaults to screen_print) — could pull from decorator capabilities
- Clients list page uses Tailwind while job detail uses inline styles (inconsistent but functional)

## Owner

Jon Burrow — not a developer. Keep changes surgical, test before committing, explain what changed.
