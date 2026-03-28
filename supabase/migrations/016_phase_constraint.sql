-- Update phase constraint for lifecycle v2
ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_phase_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_phase_check CHECK (phase IN ('intake', 'pending', 'ready', 'production', 'receiving', 'fulfillment', 'complete', 'on_hold', 'cancelled'));

-- Map old phases to new
UPDATE jobs SET phase = 'ready' WHERE phase = 'pre_production';
UPDATE jobs SET phase = 'complete' WHERE phase = 'shipped';
UPDATE jobs SET phase = 'complete' WHERE phase = 'shipping';
