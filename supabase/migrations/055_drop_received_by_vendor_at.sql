-- Drop the orphaned received_by_vendor_at column on decorator_assignments.
-- Added in mig 045 to back a "Blanks Received" button on the vendor
-- portal, but the button was deleted shortly after (HPD doesn't need
-- that vendor-side acknowledgement — vendor entering tracking is the
-- real progress signal). The column has zero readers in the codebase
-- now, so it's safe to drop.
--
-- Idempotent: IF EXISTS guards a re-run.

ALTER TABLE decorator_assignments
  DROP COLUMN IF EXISTS received_by_vendor_at;
