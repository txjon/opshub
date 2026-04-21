-- Inbound replies previously landed on a shared catch-all address
-- (production@, hello@, etc.) instead of a per-job plus-addressed
-- reply-to. The inbound capture handler fell back to associating
-- those replies with a job_id anyway, which polluted per-project
-- email history with messages belonging to other jobs.
--
-- Until per-job reply routing is rebuilt (Option B), null out the
-- job_id on every existing inbound row so the Overview "Emails sent
-- from OpsHub" panel stays honest. Rows are preserved for archival.
--
-- This is idempotent — re-running it only touches rows that still
-- have a non-null job_id.

UPDATE email_messages
SET job_id = NULL
WHERE direction = 'inbound'
  AND job_id IS NOT NULL;
