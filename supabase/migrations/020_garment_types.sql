-- Expand garment_type to cover all QB product types
ALTER TABLE items DROP CONSTRAINT IF EXISTS items_garment_type_check;
ALTER TABLE items ADD CONSTRAINT items_garment_type_check CHECK (garment_type IN (
  'tee','hoodie','longsleeve','crewneck','jacket','pants','shorts',
  'hat','beanie','tote','patch','poster','sticker','custom',
  'socks','bandana','banner','flag','pin','koozie','can_cooler',
  'key_chain','custom_bag','pillow','rug','towel','water_bottle',
  'pens','napkins','woven_labels','balloons','stencils','samples',
  'lighter','accessory'
));
