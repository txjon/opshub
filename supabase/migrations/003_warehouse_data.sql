-- Per-item receiving metadata: carrier, tracking, location, condition, receivedAt
-- Stored as JSONB to avoid schema churn for what is essentially a form blob
alter table items add column if not exists receiving_data jsonb default null;

-- Job-level shipping state: fulfillment stage + notes
-- We'll store this in type_meta (ship_stage, ship_notes) which already exists
