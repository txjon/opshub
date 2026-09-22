-- 188: /hours weekly submissions. Submit used to be email-only, so nobody
-- could tell whether a week had been sent. One row per submit (resubmits
-- append; latest wins). `snapshot` is the canonical punch fingerprint at
-- submit time — the page recomputes it to flag edits made after submitting.

create table if not exists hours_submissions (
  id uuid primary key default gen_random_uuid(),
  week_start date not null,
  week_end date not null,
  total_hours numeric not null,
  snapshot text not null,
  submitted_by uuid,
  submitted_by_name text,
  submitted_at timestamptz not null default now()
);
create index if not exists idx_hours_submissions_week
  on hours_submissions(week_start, submitted_at desc);

-- Same gating as contractors / contractor_time_entries (094): internal tool.
alter table hours_submissions enable row level security;
drop policy if exists "Authenticated manage hours_submissions" on hours_submissions;
create policy "Authenticated manage hours_submissions" on hours_submissions
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on table hours_submissions to authenticated;
grant all on table hours_submissions to service_role;

notify pgrst, 'reload schema';
