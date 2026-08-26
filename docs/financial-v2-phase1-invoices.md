# Financial V2 · Phase 1 — Invoices (AR index + close-out)

Specced 2026-08-13 (Jon + Claude Code session).
Status: **PHASE 1 COMPLETE 2026-08-24 (c2c47516)** — 1a–1e all shipped. lib/ar.ts +
/invoices (index + close-out, mig 163), fulfillment routes home (/invoices/fulfillment/*,
redirects at old paths), dashboard AR alerts render (Clients → Invoices), God Mode aging
on lib/ar (diffed: total identical to the dollar; buckets reclassified terms-aware),
reconcile fixes: shared billable-qtys (forwarded > received for warehouse routes; modal +
QB push identical), per-item mixed-route isFullyShipped, two-tap Reopen on Final.
DEFERRED: God Mode cash-forecast block still carries its own (identical) expected-date
chain copy — dedup when next touching that page.
Prereq reading: this doc, then `lib/job/invoice-derive.ts`, `lib/billing-queue.ts`,
`lib/analytics.ts`, the AR sections of `app/(dashboard)/god-mode/page.tsx` (lines ~320–420
cash forecast, ~530–560 AR aging), and memory `opshub-invoice-reconcile-pull-gap`.

## Why

The Office surfaces don't flow. Inventory (2026-08-13) found:

- **No cross-job invoice list with statuses exists anywhere.** Closest is /reports →
  Payments (payment rows, not invoices, date-range-clipped). `/dashboard` computes
  create-invoice / send-invoice / overdue-payment alerts, tags them `column: "billing"`,
  and drops them — /billing is AP-only, so AR alerts render nowhere.
- **Warehouse/fulfillment billables** (a full revenue workflow: generate → price → QB
  push → email → paid) live under `/integrations/shipstation` with the wizard routed at
  `/reports/shipstation/*`. Revenue work filed under plumbing.
- **No project close-out.** Invoice-paid, costs-reconciled, and job-complete live on three
  unconnected surfaces. `lib/revenue.ts`'s header explicitly defers "financial close."

## The Office end-state (context, later phases)

```
The Office
  God Mode   — cockpit (read):  cash forecast, health, margin; tiles link into Invoices
  Invoices   — money IN (act):  THIS PHASE
  Bills      — money OUT (act): /billing + /reconciliation merged, capability-gated (Phase 2)
  The Archive — history (read): god-mode-v2 renamed (Phase 3, with Reports fold-in to God Mode)
```

Phase 1 builds Invoices only. Bills merge, Reports fold-in, and renames are OUT OF SCOPE.

## Ground rules

1. **Actions stay at the source.** The per-job invoice surface (job page, Invoice gate,
   Drafted → Sent → Paid → Reconcile → Final rail — locked by Jon 2026-07-18) keeps ALL
   job-invoice actions: send, re-sync, reconcile, payments. The fulfillment detail page
   keeps its actions. The Invoices index is a **read index + queue that deep-links**.
   Its ONLY writes are close-out (`financial_closed_at`) and reopen.
2. **One source of truth for every derived number.** No inline AR math on the new page;
   everything comes from `lib/ar.ts` (new), which itself reuses `invoice-derive` and
   `analytics` — never re-deriving what those own.
3. **Both revenue streams are equals.** Job invoices and ShipStation/fulfillment invoices
   appear in one list with one aging model. (FOG makes the recurring stream a first-class
   citizen, not a side dish.)

## Build 1a — `lib/ar.ts` (the shared AR spine)

One module, consumed by /invoices, God Mode, and the dashboard alerts.

```ts
type InvoiceRow = {
  stream: "job" | "fulfillment";
  id: string;                    // job id or shipstation_reports id
  href: string;                  // /jobs/[id]?tab=invoice  |  /invoices/fulfillment/[id]
  clientId: string; clientName: string;
  label: string;                 // job title | "Full Service · Jul 1–15"
  invoiceNumber: string | null;  // type_meta.qb_invoice_number | qb_invoice_number
  state: "drafted" | "sent" | "paid" | "reconcile" | "final"   // job stream: EXACTLY the
       | "invoiced" | "ss_paid";                               // invoice-derive rail step;
                                                               // fulfillment: invoiced/paid
  billed: number;                // qb_total_with_tax fallback per lib/revenue priority
  paid: number; balance: number;
  dueDate: string | null;        // from payment_records due dates | created_at + client terms
  aging: "not_due" | "on_terms" | "overdue_30" | "overdue_60" | "overdue_90";
  expectedDate: string | null;   // ported from god-mode forecast logic (terms-aware)
};
```

Rules:
- **Job stream state = `invoice-derive`'s rail step verbatim** (import/extract, don't copy).
  Uninvoiced jobs (no qb_invoice_number) are NOT rows — they surface only as the
  dashboard's create-invoice alerts. Cancelled excluded. `pnlJobs` policy applies
  (no test, no inventory jobs).
- **Fulfillment stream**: rows where `isInvoicedReport` (qb_invoice_number || sent_at);
  paid from `paid_at`/webhook stamps.
- **Aging is DERIVED, never read from stored status.** Stored payment status is a hint;
  "viewed" is unreliable, "overdue" is computed: past due date → overdue buckets;
  before due date under net terms → `on_terms` (waiting is normal, not a problem).
- Port God Mode's expected-date logic (unpaid due dates → target_ship + terms →
  created + terms) INTO this lib, then **God Mode's page swaps its inline AR-aging and
  cash-forecast blocks to consume lib/ar.ts** — zero visual change, dedup only.

## Build 1b — `/invoices` (the surface)

- Catalog: `{ key: "/invoices", href: "/invoices", label: "Invoices", group: "owner", sensitive: true }`.
  Grants: Jon (god), Corey, **Abigail** (she bills; AR visibility belongs to her). Seed via
  targeted `page_access` update.
- Hub-adjacent but standard T dark board styling is fine for Phase 1 (the hub-skin Office
  rebuild is a later phase — don't gold-plate).
- Layout:
  1. **KPI strip**: total outstanding · overdue · on terms · expected next 30d (all lib/ar).
  2. **Aging strip**: terms-aware buckets (not_due / on_terms / 30 / 60 / 90+), clickable → filters.
  3. **The index**: one table, both streams. Columns: date · client · invoice # · label ·
     state (rail chip, stream-appropriate) · billed · paid · balance · due/aging.
     Filters: stream, client, state, "overdue only". Search: invoice #, client, title.
     Row click → deep-link (rule 1). Money always shows cents (client-facing convention).
  4. **Close-out tab** — see 1c.
- DESIGN.md applies: no pills for status (flat uppercase color text), mono for money/dates,
  mobile-friendly (table scrolls in its own container), empty states teach.

## Build 1c — Close-out queue

Definition — a job is **closeable** when ALL of:
1. Phase = complete
2. Invoice state = Final (reconcile done) — or Paid where no reconcile was required
3. Balance = 0 (per lib/ar)
4. Cost-complete per `lib/billing-queue` (`costComplete` — every vendor billed or
   dispositioned via `cost_vendor_status`)

Rules (locked in session 2026-08-13):
- **Freight does NOT gate close-out.** UPS invoices lag weeks; a close with freight
  outstanding records a disposition note ("closed, freight pending") instead of blocking.
  Late freight still lands in cost_entries and Variances as today. Negative shipping
  variance is the freight-margin business model — never flag it as a defect.
- **Terms-aware**: jobs waiting inside net terms don't appear as "stuck," they appear as
  on_terms with the expected date.
- **Scope**: job stream only. Fulfillment clients (FOG) are a continuous stream and never
  "close." pnlJobs policy applies.
- Close action → `jobs.financial_closed_at = now()`, `financial_closed_by = user id`
  (**new migration**: two nullable columns on jobs; take the next migration number at
  build time; apply via scripts/apply-mig pattern). Reopen clears both. Owner-gated
  (is_god or /invoices grant). Closed jobs leave the queue and get a CLOSED flat label
  in the index.
- Close-out is the formalization `lib/revenue.ts` deferred — update its header comment.

## Build 1d — Route moves (fulfillment billables come home)

- `/reports/shipstation/new` → `/invoices/fulfillment/new` (wizard, unchanged internally)
- `/reports/shipstation/[id]` → `/invoices/fulfillment/[id]` (detail, unchanged)
- Old paths become redirects (bookmarks/muscle memory). Access for the new paths resolves
  via the `/invoices` key by prefix — verify with `pathToPageKey`.
- `/integrations/shipstation` (the list) is superseded by the index filtered to
  stream=fulfillment → replace the page with a redirect to `/invoices?stream=fulfillment`.
  The integrations card grid loses the ShipStation "billables" link; ShipStation stays
  listed there only as a connection/plumbing card.
- Grep-and-fix every link to the old routes (integrations page, any board links, emails
  do NOT link admin routes — verify).

## Build 1e — Riders (do in the same phase)

1. **The three `opshub-invoice-reconcile-pull-gap` fixes** (the close-out queue is built
   on this flow; fix it first): (a) reconcile modal must bill CLIENT-DELIVERED qtys
   (forwarded + shipped_out), not warehouse `received_qtys`; (b) `isFullyShipped` must
   handle MIXED-route jobs (today the reconcile card never shows on them); (c) allow
   reopening a Final invoice (owner).
2. **Dashboard AR alerts get their home**: `SECTION_BY_TYPE` routes create-invoice /
   send-invoice / overdue-payment alerts to a section linking `/invoices` (and the job
   page for per-job actions). This is the acceptance test that the surface is real.
3. **God Mode consumes lib/ar.ts** (from 1a) — delete its inline duplicates.

## Out of scope (later phases — do NOT start)

- Phase 2: **SHIPPED 2026-08-25 (c42a57b7)** — Bills = one surface at /billing (nav
  "Bills"); billingOnly derived server-side (god / /reconciliation grant / owner-manager
  fallback); /reconciliation redirects + twinned; Variances stays full-powers-gated.
- Phase 3: Reports folds into God Mode (views are subsets; CSV export moves along);
  god-mode-v2 renamed "The Archive"; Office hub-skin rebuild.
- Money-model audit beyond what lib/ar.ts forces (the full audit is the Financial V2
  program's step 1 when Jon opens that design session).

## Acceptance

- [ ] One page lists every invoice from both streams with correct derived state + aging
- [ ] Abigail can see it; warehouse roles cannot
- [ ] Job rows deep-link to the job Invoice surface; fulfillment rows to the detail page
- [ ] No send/adjust/payment actions exist on the index
- [ ] Close-out queue shows only closeable jobs per the four conditions + three rules;
      close stamps and removes; reopen works
- [ ] Old shipstation routes redirect; nothing links them; access resolves
- [ ] Dashboard AR alerts render and link correctly
- [ ] God Mode AR aging + forecast numbers UNCHANGED after the lib/ar swap (diff them)
- [ ] The three reconcile-flow fixes verified on a mixed-route job
- [ ] tsc clean on touched files; no new eslint no-undef in .jsx
