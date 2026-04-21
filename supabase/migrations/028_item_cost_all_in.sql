-- Per-item fully-loaded cost snapshot.
-- items.cost_per_unit stores just the blank cost (from Product Builder).
-- cost_per_unit_all_in stores the full cost per unit as CostingTab calculates
-- it: blanks + decoration + setup + specialty + finishing + packaging, allocated
-- to each unit. This lets god-mode + any future reporting compute exact
-- per-item margin instead of proportionally allocating job-level totalCost.
--
-- Written by CostingTab whenever costing is saved (alongside sell_per_unit).
-- Legacy items without this value fall back to proportional allocation.

ALTER TABLE items ADD COLUMN IF NOT EXISTS cost_per_unit_all_in numeric(10,2);
