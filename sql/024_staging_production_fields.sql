-- Add ETA and payment received fields for In Production tab
alter table staging_items add column if not exists eta date;
alter table staging_items add column if not exists payment_received boolean default false;
