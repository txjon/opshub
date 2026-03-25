-- Add tour and webstore client types
alter table clients drop constraint if exists clients_client_type_check;
alter table clients add constraint clients_client_type_check check (client_type in ('corporate','brand','artist','tour','webstore'));
