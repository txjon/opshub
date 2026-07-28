-- 148: THE LAB — ROOM 2 (the designer lane). The second ping-pong table:
-- OpsHub <-> designer, hard-walled from the client (the designer never sees the
-- client). A work order hangs off a design thread (lab_threads); it has its own
-- message thread carrying deliveries + revisions. Reuses the lab-studio bucket
-- for files. Still fully isolated: own tables, service-role only (RLS on, no
-- policies), touches nothing in production.

create table if not exists lab_work_orders (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references lab_threads(id) on delete cascade,   -- the design this is for
  -- what we need made: creative (from scratch) / vector clean-up / separations.
  -- (mockups are internal — never a work order.)
  type text not null check (type in ('creative','vector','separations')),
  title text,                                  -- denormalized design title, for display
  instructions text,
  due_by date,
  designer_name text,                          -- who we're handing it to (optional)
  token text not null unique,                  -- the designer's magic link (API-generated)
  source_file_url text,                        -- the design/refs we hand over (client stripped)
  accepted_file_url text,                      -- the file we accepted = production-ready
  -- loose state, mirrors the studio's vocabulary. No dead-ends.
  state text not null default 'out' check (state in ('out','delivered','in_revision','accepted')),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists lab_wo_messages (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references lab_work_orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('hpd','designer')),
  sender_name text,
  body text,
  file_url text,
  file_name text,
  kind text not null default 'comment' check (kind in ('comment','delivery','revision','accept')),
  created_at timestamptz not null default now()
);

create index if not exists lab_work_orders_thread_idx on lab_work_orders(thread_id);
create index if not exists lab_wo_messages_wo_idx on lab_wo_messages(work_order_id, created_at);

alter table lab_work_orders enable row level security;
alter table lab_wo_messages enable row level security;
-- Same as the rest of the Lab: intentionally NO policies. Every read/write goes
-- through /api/lab/* on the service role, which bypasses RLS.
