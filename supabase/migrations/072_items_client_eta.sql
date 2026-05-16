-- Per-item Client ETA — manual override of the estimated delivery date
-- shown to the client. Independent from jobs.target_ship_date (which
-- continues to drive the internal vendor-ship timeline math). When
-- client_eta is null, surfaces fall back to jobs.target_ship_date for
-- display purposes only.
--
-- Replaces the per-item eta field from the legacy /staging tool; the
-- staging board was where this lived before OpsHub had its own.

alter table items
  add column if not exists client_eta date,
  add column if not exists client_eta_set_at timestamptz,
  add column if not exists client_eta_note text;
