-- Art pricing requests — a lightweight, outside-the-decorator-flow way to
-- ask a graphic artist to price artwork (art $ + screen count). The designer
-- gets a tokenized gallery link to download the job's art files without ever
-- touching the raw Google Drive link. The returned price is entered manually
-- as an Additional charge on the quote (email-back v1). See the OpsHub art
-- request feature (2026-07-20).

create table if not exists art_requests (
  id             uuid primary key default gen_random_uuid(),
  token          text unique not null,
  job_id         uuid not null references jobs(id) on delete cascade,
  company_id     uuid,
  designer_email text not null,
  designer_name  text,
  message        text,
  status         text not null default 'sent',   -- sent | quoted | closed
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists art_requests_job_id_idx on art_requests(job_id);
create index if not exists art_requests_token_idx  on art_requests(token);

-- Access is exclusively via the service role (the send API + the public
-- gallery both read/write with the service-role client, which bypasses RLS).
-- Enable RLS with no policies so the anon/authenticated Data API can't touch
-- it directly. Explicit grants per the new-table Data API grant requirement.
alter table art_requests enable row level security;
grant all on art_requests to service_role;
grant select, insert, update on art_requests to authenticated;
