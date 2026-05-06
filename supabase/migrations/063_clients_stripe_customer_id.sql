-- Cache the Stripe customer id on clients (parallel to qb_customer_id).
-- Lets the invoice-push path skip the email-search round-trip on
-- subsequent pushes for the same client. The Stripe customer is
-- per-company so a client linked to multiple tenants would have
-- different Stripe customer ids in each, but since we don't share
-- clients across tenants (each tenant has its own client list per
-- mig 058), one column is enough.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE INDEX IF NOT EXISTS idx_clients_stripe_customer_id
  ON clients(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
