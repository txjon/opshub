-- 027_ship_notes.sql
-- Production shipping notes that carry over to receiving

ALTER TABLE items ADD COLUMN IF NOT EXISTS ship_notes TEXT;
