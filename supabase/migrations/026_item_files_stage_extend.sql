-- Formalize item_files.stage CHECK constraint to match stages already used
-- in code (packing_slip and receiving_photo are written by
-- app/(dashboard)/receiving and app/(dashboard)/production). Idempotent.
ALTER TABLE item_files DROP CONSTRAINT IF EXISTS item_files_stage_check;
ALTER TABLE item_files ADD CONSTRAINT item_files_stage_check
  CHECK (stage IN ('client_art','vector','mockup','proof','print_ready','packing_slip','receiving_photo'));
