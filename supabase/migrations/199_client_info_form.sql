-- 199: the client info form (Oct 13 2026) — clients update their own company
-- info, contacts, addresses and resale certificates from their hub
-- (/portal/client/[token]/company). Company/contacts/addresses apply on
-- submit; tax certificates wait for staff review, and approving one is what
-- marks the QuickBooks customer exempt (QB = the tax switch, mig 198).

-- company identity the form collects
alter table clients add column if not exists legal_name text;
alter table clients add column if not exists ein text;
alter table clients add column if not exists invoice_po_required boolean not null default false;
-- per-address delivery detail (carriers / dock)
alter table client_locations add column if not exists delivery_notes text;

-- one row per form submission: who signed, the full snapshot, the diff applied
create table if not exists client_info_submissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid not null references clients(id) on delete cascade,
  signer_name text not null,
  signer_title text,
  signer_email text,
  payload jsonb not null,                    -- exactly what they submitted
  applied jsonb not null default '[]'::jsonb,-- human-readable list of what changed
  tax_review text not null default 'none' check (tax_review in ('none','pending','done')),
  submitted_at timestamptz not null default now()
);
create index if not exists idx_client_info_submissions_client on client_info_submissions(client_id, submitted_at desc);

-- resale / exemption certificates: one per state, each with its file
create table if not exists client_tax_certificates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references companies(id) on delete restrict,
  client_id uuid not null references clients(id) on delete cascade,
  submission_id uuid references client_info_submissions(id) on delete set null,
  state text not null,                       -- 2-letter, or 'MULTI' (MTC / SST)
  permit_number text not null,
  expires_on date,
  client_file_id uuid references client_files(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_client_tax_certificates_client on client_tax_certificates(client_id, status);

do $$
declare tbl text;
begin
  foreach tbl in array array['client_info_submissions', 'client_tax_certificates'] loop
    execute format('alter table %I enable row level security', tbl);
    execute format('drop policy if exists "team all" on %I', tbl);
    execute format('create policy "team all" on %I for all to authenticated using (true) with check (true)', tbl);
    execute format('grant all on table %I to authenticated, service_role', tbl);
    execute format('drop trigger if exists fill_company_id on %I', tbl);
    execute format('create trigger fill_company_id before insert on %I for each row execute function default_company_id_to_hpd()', tbl);
  end loop;
end $$;
notify pgrst, 'reload schema';
