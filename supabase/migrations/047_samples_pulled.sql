-- Per-size sample qtys pulled from a received order (QA, photoshoot,
-- client comp, etc.). Continuing qty for fulfillment = received - samples.
-- Future enhancement may move this to a samples_pulled log table that
-- tracks destination per pull; for now a simple per-size number per
-- item is enough.
ALTER TABLE items
  ADD COLUMN IF NOT EXISTS sample_qtys jsonb NOT NULL DEFAULT '{}'::jsonb;
