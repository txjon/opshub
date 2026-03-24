-- Store pipeline_stage directly on items so it persists even without a decorator assignment
alter table items add column if not exists pipeline_stage text default 'blanks_ordered';
