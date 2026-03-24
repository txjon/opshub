-- Multiple contacts per decorator stored as JSONB array
-- Each entry: {name, email, phone, role}
alter table decorators add column if not exists contacts_list jsonb default '[]';
