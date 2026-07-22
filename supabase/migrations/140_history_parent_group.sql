-- 140: QB API categories are hierarchical ("Accessories:Hats") — keep the
-- parent for rollups (Apparel vs Accessories vs Services), leaf stays in
-- product_group so existing readers see clean names.
alter table history_sales add column if not exists product_parent text;
