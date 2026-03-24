-- Update job_type to include drop_ship
alter table jobs drop constraint if exists jobs_job_type_check;
alter table jobs add constraint jobs_job_type_check check (job_type in ('tour','webstore','corporate','brand','drop_ship'));

-- Update client_type to standardize
alter table clients drop constraint if exists clients_client_type_check;
alter table clients add constraint clients_client_type_check check (client_type in ('corporate','brand','artist'));
