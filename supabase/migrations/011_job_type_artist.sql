-- Align job_type with client_type options
alter table jobs drop constraint if exists jobs_job_type_check;
alter table jobs add constraint jobs_job_type_check check (job_type in ('corporate','brand','artist','tour','webstore','drop_ship'));
