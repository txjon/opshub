-- 184: items.blank_supplier (Sep 21 2026). Which catalog the blank was picked
-- from (S&S, AS Colour, LA Apparel, Cotton Collective). The picker knew but
-- never stored it; the rep-order email needs it to offer only the suppliers
-- actually on the selected items. Written on every blank assign from here on.
alter table items add column if not exists blank_supplier text;
notify pgrst, 'reload schema';
