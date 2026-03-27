-- Blanks ordering fields per item
alter table items add column if not exists blanks_order_number text;
alter table items add column if not exists blanks_order_cost numeric(10,2);

-- Shipping from decorator fields per item
alter table items add column if not exists ship_tracking text;
alter table items add column if not exists ship_qtys jsonb default '{}';

-- Phase timestamps on jobs (records when each phase was entered)
alter table jobs add column if not exists phase_timestamps jsonb default '{}';

-- Quote approval tracking on jobs
alter table jobs add column if not exists quote_approved boolean default false;
alter table jobs add column if not exists quote_approved_at timestamptz;

-- Update pipeline_stage constraint to new simplified stages
-- Old: blanks_ordered, blanks_shipped, blanks_received, strikeoff_approval, in_production, shipped
-- New: blanks_ordered, in_production, shipped
