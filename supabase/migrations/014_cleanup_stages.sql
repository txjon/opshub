-- Map old pipeline stages to new simplified stages
-- Old: blanks_ordered, blanks_shipped, blanks_received, strikeoff_approval, in_production, shipped
-- New: blanks_ordered (pre-production default), in_production, shipped

UPDATE items SET pipeline_stage = 'in_production' WHERE pipeline_stage IN ('blanks_shipped', 'blanks_received', 'strikeoff_approval');
UPDATE decorator_assignments SET pipeline_stage = 'in_production' WHERE pipeline_stage IN ('blanks_shipped', 'blanks_received', 'strikeoff_approval');
