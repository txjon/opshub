-- Store timestamps for each pipeline stage transition
alter table items add column if not exists pipeline_timestamps jsonb default '{}';
