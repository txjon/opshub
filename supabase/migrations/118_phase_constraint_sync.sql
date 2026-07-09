-- 118 — Sync the repo with the LIVE jobs_phase_check.
--
-- Migration 016 in this repo allows only 9 phases, but prod's constraint was
-- relaxed by hand (out-of-repo) to also allow 'pre_production' and 'shipping'
-- — lifecycle.ts returns 'shipping' for the ship-through wave state, and 8
-- jobs carried it at the time of this audit (2026-07-08). Without this file,
-- a fresh environment built from migrations rejects phases prod depends on.
-- No-op against prod; recorded so the repo is the truth again.
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_phase_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_phase_check CHECK (phase IN (
  'intake', 'pending', 'ready', 'pre_production', 'production',
  'receiving', 'shipping', 'fulfillment', 'complete', 'on_hold', 'cancelled'
));
