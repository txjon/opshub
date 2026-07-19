-- 127: Per-decorator default ship method.
-- Auto-fills the PO pre-send modal's Ship Method (overwritable), alongside the
-- existing default_shipping_route + lead_time_days defaults.
ALTER TABLE decorators ADD COLUMN IF NOT EXISTS default_ship_method text;
