-- Intake submissions queue.
--
-- Powers the public /start 6-step form. Every submission lands as its
-- own row in this table — separate from `clients` so the customer list
-- stays clean and the team controls when a lead becomes an actual
-- client.
--
-- Lifecycle:
--   new        — just landed, no one's looked at it yet
--   reviewed   — someone on the team has read it
--   converted  — promoted to a clients row (client_id is set)
--   declined   — not worth pursuing
--
-- Files attach as JSONB (filename + signed URL + size + storage path),
-- pre-uploaded to the intake-uploads bucket. The /intake page renders
-- them inline; conversion copies the file references onto the new
-- client / project record (or just keeps them on the submission for
-- audit).
--
-- We deliberately don't auto-create a clients row at submit time.
-- The convert action is explicit so the team can de-dupe against
-- existing clients before promoting.

create table if not exists intake_submissions (
  id uuid primary key default gen_random_uuid(),

  -- Status flow
  status text not null default 'new'
    check (status in ('new', 'reviewed', 'converted', 'declined')),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,

  -- Conversion linkage (set when status = 'converted')
  client_id uuid references clients(id) on delete set null,
  project_id uuid references jobs(id) on delete set null,

  -- Step 1 — project type
  project_type text,  -- brand / tour / corporate / webstore (free-text-tolerant)

  -- Step 2 — details
  project_name text,
  description text,
  items_count_range text,
  units_range text,
  target_ship_date date,
  budget_range text,

  -- Step 3 — files. JSONB array of { filename, url, path, size }
  files jsonb not null default '[]'::jsonb,

  -- Step 4 — items breakdown. JSONB array of { name, sizes: {S: 10, M: 20, ...} }
  items jsonb not null default '[]'::jsonb,

  -- Step 5 — contact + shipping
  contact_name text not null,
  contact_email text not null,
  contact_phone text,
  company text not null,
  shipping_route text,  -- ship_to_us / drop_ship / hold_for_fulfillment

  -- Multi-tenant — submission is owned by the tenant whose marketing
  -- site collected it. Today only HPD has a public site; IHM will get
  -- one later.
  company_slug text not null default 'hpd',

  -- Free-text catch-all for anything the form schema didn't capture
  -- (e.g. notes the team adds during review).
  notes text,

  created_at timestamptz not null default now()
);

create index if not exists idx_intake_submissions_status_created
  on intake_submissions(status, created_at desc);

create index if not exists idx_intake_submissions_company_slug
  on intake_submissions(company_slug);

alter table intake_submissions enable row level security;

-- Auth'd team members can read/write. RLS is permissive within the
-- dashboard — tenant gating happens at the query layer via company_slug.
drop policy if exists "Authenticated users can manage intake_submissions" on intake_submissions;
create policy "Authenticated users can manage intake_submissions"
  on intake_submissions for all to authenticated using (true) with check (true);
