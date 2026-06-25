-- Vendor-invoice attachments on a bill, stored in OpsHub (Supabase Storage).
-- A "bill" = the cost_entries saved together in one New Bill action, grouped by
-- bill_group_id (more robust than invoice #, since a batched bill can span
-- several vendor invoices). Files live in the private 'bill-invoices' bucket;
-- bill_attachments holds the metadata.

alter table cost_entries add column if not exists bill_group_id uuid;
create index if not exists cost_entries_bill_group_idx on cost_entries(bill_group_id);

create table if not exists bill_attachments (
  id uuid primary key default gen_random_uuid(),
  bill_group_id uuid not null,
  company_id uuid,
  file_name text not null,
  mime_type text,
  size_bytes bigint,
  storage_path text not null,
  created_at timestamptz not null default now(),
  created_by text
);
create index if not exists bill_attachments_group_idx on bill_attachments(bill_group_id);

alter table bill_attachments enable row level security;
-- Authenticated app users can read/manage; the upload route uses the service
-- role (bypasses RLS) for the storage write.
create policy "bill_attachments authed read" on bill_attachments for select to authenticated using (true);
create policy "bill_attachments authed write" on bill_attachments for all to authenticated using (true) with check (true);

-- Private bucket for the invoice files.
insert into storage.buckets (id, name, public)
values ('bill-invoices', 'bill-invoices', false)
on conflict (id) do nothing;
