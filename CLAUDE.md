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
  dashboard/          — KPI dashboard (server component)
  jobs/               — Project list with search + phase filters
  jobs/new/           — New project form with client typeahead + creation modal
  jobs/[id]/          — Project detail (main hub, vertical tab nav)
  clients/            — Client list
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
  email/send/         — Send quote/PO PDF via Resend
  pdf/po/[jobId]/     — Generate PO PDF via Browserless
  pdf/quote/[jobId]/  — Generate quote PDF via Browserless
  ss/                 — S&S Activewear API proxy
```

### Project Detail Page (`jobs/[id]/`)

The central hub. Vertical tab nav on the left, content on the right. 7 tabs, each its own component:

| Tab | Component | Owns |
|---|---|---|
| Overview | Inline in page.tsx | Project info, contacts CRUD, payments CRUD, shipping details, items summary |
| Buy Sheet | BuySheetTab.jsx | Item creation, size/qty entry, S&S + manual catalog pickers |
| Costing | CostingTab.jsx | Decoration pricing, margin calc, auto-save |
| Client Quote | CostingTab.jsx (quote sub-tab) | Quote preview + PDF download/email |
| Purchase Order | POTab.jsx | PO preview, PDF export/email, packing notes |
| Production | ProductionTab.jsx | Pipeline stage tracking per item |
| Warehouse | WarehouseTab.jsx | Receiving (carrier, tracking, per-size qtys) + shipping fulfillment |

### Data Flow

**Items** are created in Buy Sheet → enriched in Costing (decoration, pricing) → tracked in Production (pipeline stages) → received in Warehouse.

**Key ownership rules (enforced in code):**
- **Client name, ship date, notes** — owned by the job record (Overview tab). Quote reads from `project` props, not separate copies.
- **Item name, sizes, quantities** — owned by Buy Sheet. Costing syncs from `buyItems` prop.
- **Blank costs** — initial source is Buy Sheet (from catalog). Costing can refine per-size costs, writes back to `items.blank_costs` on save.
- **Decorator pricing** — owned by the `decorators.pricing_data` JSONB column. CostingTab, PO route, and Quote route all load from DB on each render/request.
- **Pipeline stage** — saved on `items.pipeline_stage` (primary) and synced to `decorator_assignments` if one exists.

### Auto-Save Pattern

Used in Buy Sheet, Costing, and Warehouse tabs:
1. Local state tracks edits
2. Dirty detection via JSON comparison
3. 1500ms debounced save after any change
4. `onSaveRef` for stable function reference across renders
5. `onRegisterSave` callback so parent can force-save on tab switch
6. `onSaveStatus` feeds "saving"/"saved"/"error" to tab bar indicator
7. `beforeunload` guard warns if closing with unsaved changes

### Decorator Pricing

Pricing lives in `decorators.pricing_data` (JSONB):
```
{
  qtys: [48, 72, 144, ...],           // Quantity tiers
  prices: { 1: [...], 2: [...] },     // Per-color-count prices at each tier
  tagPrices: [...],                    // Tag print prices at each tier
  packaging: { Tee: 0.55, ... },      // Packaging variant rates
  finishing: { HangTag: 0.25, ... },   // Finishing per-unit rates
  setup: { Screens: 20, ... },         // Setup fee per-unit rates
  specialty: { Puff: 0.50, ... },      // Specialty per-unit upcosts
}
```

All sections (packaging, finishing, setup, specialty) are **dynamic** — add/rename/delete categories per decorator on the Decorators page, they show up in Costing automatically.

**Special setup fee behaviors:**
- "Screens" and "Tag Screens" (matched case-insensitively) are auto-calculated from print locations
- Setup fees whose name contains an active specialty name auto-link to that specialty's print count (e.g. "Puff Screen Up Charge" reads from Puff's count)

### Costing → Production Flow

When costing saves, it auto-creates/updates `decorator_assignments` by mapping `printVendor` (short_code or name) → `decorator_id`. Production tab reads from these assignments.

## Database

### Key Tables

| Table | Purpose |
|---|---|
| `jobs` | Core project record + `costing_data`/`costing_summary` JSONB |
| `items` | Line items per job (name, vendor, SKU, costs, `pipeline_stage`, `receiving_data`) |
| `buy_sheet_lines` | Per-size quantities with multi-stage tracking |
| `clients` | Client records (name, type, terms, notes) |
| `contacts` | Contacts linked to clients |
| `job_contacts` | Links contacts to jobs with roles |
| `decorators` | Decorator records with `pricing_data`, `contacts_list` JSONB, dual addresses |
| `decorator_assignments` | Links items to decorators with pipeline stage |
| `payment_records` | Invoice/payment tracking per job |
| `blank_catalog` | User-maintained blank garment catalog |

### JSONB Patterns

- `jobs.costing_data` — full costing state (costProds, margin, shipping/CC toggles, orderInfo)
- `jobs.costing_summary` — aggregated metrics (grossRev, totalCost, netProfit, margin)
- `jobs.type_meta` — misc metadata (ship dates, venue, shipping stage/notes)
- `items.receiving_data` — warehouse receiving metadata (carrier, tracking, location, condition)
- `items.blank_costs` — per-size blank costs
- `decorators.pricing_data` — full pricing structure (see above)
- `decorators.contacts_list` — array of {name, email, phone, role}

## Shared Code

### `lib/theme.ts`
Single source for colors, fonts, size ordering. Used everywhere via `import { T, font, mono, SIZE_ORDER, sortSizes } from "@/lib/theme"`.

**Do not hardcode color values** — always use `T.text`, `T.muted`, `T.card`, etc.

### `lib/supabase/client.ts` / `server.ts`
Shared Supabase clients. Use `createClient()` from the appropriate one — never instantiate directly.

### `components/SendEmailDialog.jsx`
Reusable email dialog with single or multi-recipient support (checkboxes for decorator contacts).

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
- **Auto-save**: 1500ms debounce, status indicator in tab bar
- **Inline styles**: Job detail components use inline styles with the `T` theme object. Layout pages (clients list, new project) use Tailwind.
- **No hardcoded pricing**: All decorator rates come from `decorators.pricing_data`. The `FALLBACK_PRINTERS` in CostingTab exists only as migration scaffolding.
- **Decimal inputs**: Use `type="text" inputMode="decimal"` with local string state to avoid parseFloat eating trailing dots. Parse on blur/commit, not on every keystroke.

## Owner

Jon Burrow — not a developer. Keep changes surgical, test before committing, explain what changed.
