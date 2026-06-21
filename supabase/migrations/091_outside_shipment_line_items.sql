-- 091: structured line items on outside shipments.
-- Each entry: { name: string, sizes: { [size: string]: number } } — mirrors the
-- production/receive item+size+qty model so logged (and later auto-extracted
-- from a packing slip) outside packages carry the same data shape.
alter table outside_shipments
  add column if not exists line_items jsonb not null default '[]'::jsonb;
