# FOG God Mode

Internal drop-analytics dashboard for Forward Observations Group, built from
their raw order-export history. Lives in OpsHub at **/fog-analytics**
(owner-gated, linked from the FOG client space) and doubles as a private
Claude artifact:
https://claude.ai/code/artifact/faa72267-c059-4997-a04d-436e8bb1657e

## Refreshing with a new export

1. Download a new order export CSV (same column set) and drop it in
   `exports/`, named by date range, e.g. `2026-08-15_to_2026-09-20.csv`.
   Overlap with the previous export is fine and encouraged (start a few days
   before the last one ended).
2. Run `./refresh.sh`
3. Commit `fog-data.json` + `app/api/fog-analytics/dashboard-html.generated.ts`
   and push dev (merge to main when ready to deploy). Optionally ask Claude to
   republish `fog-godmode.html` to the artifact URL.

exports/ and fog-godmode.html are gitignored; the generated TS is committed
because Vercel serves the page from it.

## How it's served in OpsHub

- `tools/fog-godmode/build.py` renders the template + data into a full dark
  HTML document and writes it as a TS string module:
  `app/api/fog-analytics/dashboard-html.generated.ts`.
- `app/api/fog-analytics/route.ts` serves that HTML, gated by `is_god` OR a
  `/fog-analytics` page grant.
- `app/(dashboard)/fog-analytics/page.tsx` frames it in an iframe inside the
  app shell (same gate; middleware enforces via the `/fog-analytics` row in
  `lib/access.ts` PAGE_CATALOG).
- The FOG client space (`clients/[id]`, FOG_CLIENT_ID constant) shows a
  God Mode link in its Overview header.

## How the merge works

- All CSVs in `exports/` are combined. If the same OrderNumber appears in more
  than one file, only the newest file's rows for that order are kept (newest
  by file modification time).
- KNOWN EXPORT QUIRK: the export writes one row per item PER SHIPMENT. Split
  shipments repeat the order with $0 totals and the reshipment date.
  `aggregate.py` compensates (per-order money = max across rows, order date =
  earliest row). Never analyze these CSVs with naive per-row logic.

## Definitions the dashboard uses

- Cancelled orders excluded everywhere.
- Gross = OrderTotal (includes shipping + tax). Merch = gross minus shipping
  and tax (nets discounts). Product/type revenue = item prices, pre-discount.
- A drop = consecutive days at 150+ orders/day (gaps up to 3 days merge).
- Launch clock t0 = first 15-minute bin with real volume, not the first stray
  order of the window.
- Pre-order vs in-stock: from item titles at order time (FOG practice: titles
  say PRE-ORDER at launch; renames later drop it when buffers sell in stock).
  Launches that skipped the marker get pinned in `DROP_KIND_OVERRIDES` in
  aggregate.py (e.g. the 2026-02-13 hybrid drop). The measured share is still
  shown; only comparison-set membership uses the override.
