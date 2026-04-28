-- Per-client opt-in flags for QB online payment methods. Pushed to QB
-- on every invoice create/update via AllowOnlineCreditCardPayment +
-- AllowOnlineACHPayment. Defaults to both true (current behavior); flip
-- per client if e.g. ACH-only is preferred.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS allow_cc boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS allow_ach boolean NOT NULL DEFAULT true;
