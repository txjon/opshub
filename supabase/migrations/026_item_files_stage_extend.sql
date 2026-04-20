-- Drop item_files.stage CHECK constraint. The original 008 migration restricted
-- stage to a fixed list, but code has since added packing_slip, receiving_photo,
-- and occasionally legacy values end up there. App-level enum is the source of
-- truth; the DB constraint is friction without value and blocks future additions
-- (e.g. decorator_proof in the vendor portal proof approval flow).
ALTER TABLE item_files DROP CONSTRAINT IF EXISTS item_files_stage_check;
