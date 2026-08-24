-- 163 — FINANCIAL CLOSE-OUT (Financial V2 Phase 1c, Aug 24 2026).
-- The formalization lib/revenue.ts deferred: a job is financially closed
-- when invoice-final + paid + cost-complete, stamped from /invoices.
alter table jobs add column if not exists financial_closed_at timestamptz;
alter table jobs add column if not exists financial_closed_by uuid;
