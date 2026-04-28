-- Vendor discrepancy report state on decorator_assignments.
-- last_issue_note holds the most recent open complaint from the vendor.
-- An issue is "open" while last_issue_at IS NOT NULL AND issue_resolved_at IS NULL.
-- Setting issue_resolved_at clears the alert from the team's Command Center
-- without losing the historical job_activity trace.
ALTER TABLE decorator_assignments
  ADD COLUMN IF NOT EXISTS last_issue_note text,
  ADD COLUMN IF NOT EXISTS last_issue_at timestamptz,
  ADD COLUMN IF NOT EXISTS issue_resolved_at timestamptz;
