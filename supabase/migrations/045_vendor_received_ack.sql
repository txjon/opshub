-- Vendor-side acknowledgement flag for the Blanks Received button on the
-- vendor portal. Independent from pipeline_stage so vendor clicks don't
-- move HPD's production view (HPD's PO state stays "PO sent" until the
-- vendor enters tracking — that's the real progress signal).
ALTER TABLE decorator_assignments
  ADD COLUMN IF NOT EXISTS received_by_vendor_at timestamptz;
