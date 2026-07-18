# OpsHub Design Standard

The house style. Every new page, component, modal, and mockup follows this —
no exceptions without Jon's explicit call. These rules were locked one by one
across live design sessions (June–July 2026); they are decisions, not
suggestions. **If a build deviates from this document, the build is wrong.**

## Hard rules — never do these

1. **NO pill chips. Anywhere.** Status/labels render as **flat uppercase
   color-text** (`fontSize 9.5–10, fontWeight 800, letterSpacing 0.5,
   textTransform uppercase`, colored by meaning). Buttons are allowed to look
   like buttons; labels are never capsules.
2. **No full-width color washes for notes** ("manila folder"). Notes get a
   **3px left accent rail** (purple `T.purple`) with a small uppercase NOTE
   label, on the card background.
3. **No hardcoded colors.** Every color comes from `lib/theme.ts` `T`.
4. **No bare `new Date("YYYY-MM-DD")`.** Date-only strings parse with
   `parseDay` (lib/dates) — bare parsing renders the previous day in Vegas.
5. **No browser `alert()`/`confirm()` in new code.** Use styled modals
   (ModalShell / ConfirmDialog) or undo-toasts.
6. **No new `(dashboard)` page without a `PAGE_CATALOG` entry**
   (lib/access.ts). Uncatalogued pages FAIL OPEN.
7. **No dark theme.** OpsHub is light. Mockups/artifacts for OpsHub commit to
   the light palette with the exact `T` values.

## Palette & signal semantics

From `lib/theme.ts` — but the COLOR MEANINGS are the standard:

| Token | Hex | Means |
|---|---|---|
| `T.green` | `#47b12b` | done / received / good / on-track |
| `T.amber` | `#f4b22b` | attention: partial, aging 24h+, ≤3 days out, shortage-pending |
| `T.red` | `#ff324d` | late / short / broken / aging 48h+ / destructive actions |
| `T.blue` | `#73b6c9` | movement: incoming, in transit, links out |
| `T.purple` | `#fd3aa3` | notes & pulls (held-back goods) |
| `T.text` `#1a1a1a` / `T.muted` `#6b6b78` / `T.faint` `#a0a0ad` | ink hierarchy: value / secondary / hint |
| `T.card` `#ffffff` / `T.surface` `#eaeaee` / `T.border` `#dcdce0` / `T.bg` `#f4f4f6` | grounds |

One hue, one meaning — never use amber decoratively or green for anything
that isn't done/good. Route colors: **stage = green, ship_through = blue,
drop_ship = muted.**

PDFs (vendor/client-facing, print palette): revision markers = friendly construction orange
`#f97316` (attention, not alarm — Jon 2026-07-17); red on PDFs is reserved
for true errors/shortages.

## Typography & numbers

- Fonts: `font` = IBM Plex Sans stack; `mono` = IBM Plex Mono stack
  (import from lib/theme).
- **Numbers, quantities, sizes, dates, tracking numbers, money → `mono`**,
  and columns of digits get `fontVariantNumeric: "tabular-nums"`.
- Dates display as `fmtDay` → "Jul 18" (year only when it matters).
  **`~` prefix = estimate** (human-entered or derived math); a **plain date =
  carrier/actual data**. Unknown = "TBD" in `T.faint` — never a guessed date.

## Interaction language

- **Dotted underline = click to EDIT** (`borderBottom: "1px dotted
  currentColor"`). Reserved exclusively for editable values (ETAs, dates).
- **Hover blue + underline = click to VIEW** (tracking numbers → TrackingModal,
  links). Never dotted.
- **`⋯` overflow menu (RowMenu) only at 2+ actions.** A single action renders
  as flat text (e.g. "Receive →", "box not found?"), never a menu of one.
- **Click-to-act cards:** when a card has ONE primary action, the whole card
  is the tap target (no button) — hover shows a **2.5px `T.text` ink outline**
  (`outlineOffset: -1`). Inner links/menus `stopPropagation`.
- **Aging/alarm outlines on cards:** persistent `2px` outline — amber at the
  first threshold, red at the second (e.g. delivered-not-received 24h/48h).
- Selection (multi-pick lists): **3px left ink rail**
  (`inset 3px 0 0 0 T.text`), not full frames.
- Filters: **white-box bold selects** (padding 9/14, radius 12, fontWeight
  700) for vendor/client; **fixed sorts** (soonest-first) — no sort toggles.
- Segmented controls: surface track, white active segment, bold 13px.

## Composition patterns

- **Board pages** (production2/receiving2/shipping2/staging2/distro) build
  from `components/board-kit`: BoardFrame → ToggleSearch → KpiStrip →
  SliceSortRow → Cards. Extend board-kit; never inline-clone its pieces.
- **Card header anatomy:** headline (client or vendor, 14/800) + flat
  uppercase state label; detail line below in 11.5 `T.faint` with `·`
  separators; right side = the value/action stack. No counts in headers when
  the rows already say it.
- **Modal anatomy** (ModalShell or the LedgerHistory pattern): eyebrow label
  (10px uppercase faint) → title (16–17/700) → optional summary strip
  (surface band, stat pairs) → body → footer (`borderTop`, Cancel ghost +
  primary filled). Timelines use the dot-rail pattern (8px colored dot +
  content), newest first.
- **KPI tiles:** big mono number + tiny uppercase muted label. Clickable KPIs
  open a breakdown modal.
- **Empty states teach:** say what will appear and how it gets there
  ("Nothing incoming to receive."), never a bare "No data".
- **Job-detail inline style:** `T`-object inline styles (not Tailwind) —
  match the file you're in.

## Mobile — every new page ships mobile-friendly (Jon's rule, 2026-07-17)

- **No new page is done until it works on a phone.** Use `useIsMobile()` and
  the `/hours` page as the reference pattern: stacked layouts, full-width
  inputs and tap targets, no horizontal scroll of the page body (wide
  tables/grids scroll inside their own container).
- Mobile cards: label-above-value stacks (see JobItemsList mobile branch),
  buttons full-width, modals usable at 375px.
- The pre-existing surfaces are being swept to this standard (roadmap item);
  new work must not add to that backlog.

## Voice

Plain language, sentence case. Buttons say exactly what happens
("Count in · close short"). Errors say what went wrong and what to do.
Internal jargon (wave, strip, pull) is fine — team vocabulary; abbreviations
and codes the reader must decode are not.

## Where the pieces live

`lib/theme.ts` (tokens) · `lib/dates.ts` (parse/format) · `components/board-kit.tsx`
(board primitives) · `components/TrackingModal.tsx` (view-affordance reference) ·
`components/ConfirmDialog.tsx`. History: the conventions were locked in the
July 2026 board-redesign sessions; the signal table mockup lives at
claude.ai/code/artifact/82a52b74-c970-4467-b838-d382522482fd.
