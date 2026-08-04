-- 157: the thumbs model, trimmed (Jon sign-off Aug 3 2026).
-- Thread states grow two idea-level verdicts from the thumbs-down sheet:
--   shelved (not now, not wrong — leaves the client's view, dim on ours)
--   killed  (done exploring — record only, revived by nobody)
-- Message kinds grow the two new markers (like, order).
-- lab_order_requests = the Order-it ask: blank + qty + note, captured at the
-- wall. The sandbox stops here; graduation re-points these at real products
-- and jobs (mig 137 machinery). Service-role access only, like all lab_*.

alter table lab_threads drop constraint if exists lab_threads_state_check;
alter table lab_threads add constraint lab_threads_state_check
  check (state in ('working','with_client','approved','shelved','killed'));

alter table lab_messages drop constraint if exists lab_messages_kind_check;
alter table lab_messages add constraint lab_messages_kind_check
  check (kind in ('comment','version','change_request','approval','submission','like','order'));

create table if not exists lab_order_requests (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lab_threads(id) on delete cascade,
  client_id uuid not null references lab_clients(id) on delete cascade,
  design_msg_id uuid references lab_messages(id) on delete set null,
  design_file_url text,
  blank text,
  qty integer,
  note text,
  handled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists lab_order_requests_open_idx on lab_order_requests(created_at) where handled_at is null;

alter table lab_order_requests enable row level security;
-- Intentionally NO policies — /api/lab/* on the service role is the only door.
