-- 088: capture the Shopify product image URL on pre-order products so it can
-- be auto-materialized as a Drive mockup on the item when the pre-order is
-- pushed to a Labs job. Additive; null until the import fills it.
ALTER TABLE preorder_products ADD COLUMN IF NOT EXISTS image_url text;
COMMENT ON COLUMN preorder_products.image_url IS 'Public Shopify CDN product image (Image Src from the products export). Auto-uploaded to Drive as the item mockup on push-to-production.';
