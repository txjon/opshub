-- 116_item_size_subs.sql
-- Per-size blank substitution metadata on items.
--
-- When an assigned blank doesn't cover a needed size — or a size/color/brand sells
-- out and we pivot for just one size — we substitute a different blank for THAT size
-- only. Decoration is always identical (otherwise it's a separate item); the customer
-- price is unchanged, only our cost/margin moves.
--
-- The substitute's per-unit COST goes into the existing per-size items.blank_costs
-- (which already drives costing + margin). This column holds the descriptive part
-- that drives the PO note and the buy-sheet badge.
--
-- Shape: { "<SIZE>": { "label": "Gildan 2000", "color": "Sand", "note": "5001 maxes at 3XL" }, ... }
-- All inner fields optional; the presence of a size key marks that size as substituted.

ALTER TABLE items ADD COLUMN IF NOT EXISTS size_subs jsonb NOT NULL DEFAULT '{}'::jsonb;
