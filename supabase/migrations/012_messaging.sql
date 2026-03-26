-- Job activity feed: auto-logged events + manual comments per job
create table job_activity (
  id          uuid primary key default gen_random_uuid(),
  job_id      uuid references jobs(id) on delete cascade,
  user_id     uuid references auth.users(id),
  type        text not null default 'comment' check (type in ('comment','auto')),
  message     text not null,
  metadata    jsonb default '{}',
  created_at  timestamptz default now()
);

create index idx_job_activity_job_id on job_activity(job_id);
create index idx_job_activity_created on job_activity(created_at);

alter table job_activity enable row level security;
create policy "Authenticated users can manage job activity"
  on job_activity for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Party Line: global team chat
create table messages (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id),
  message     text not null,
  created_at  timestamptz default now()
);

create index idx_messages_created on messages(created_at);

alter table messages enable row level security;
create policy "Authenticated users can manage messages"
  on messages for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- Notifications: per-user unread items
create table notifications (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id),
  type          text not null check (type in ('mention','alert','approval','payment','production')),
  message       text not null,
  reference_id  uuid,
  reference_type text,
  read          boolean default false,
  created_at    timestamptz default now()
);

create index idx_notifications_user on notifications(user_id, read);

alter table notifications enable row level security;
create policy "Users can see their own notifications"
  on notifications for select
  using (auth.uid() = user_id);
create policy "Authenticated users can create notifications"
  on notifications for insert
  with check (auth.role() = 'authenticated');
create policy "Users can update their own notifications"
  on notifications for update
  using (auth.uid() = user_id);
