-- Proofs become VERSIONS, not files (Sep 2026).
--
-- The proof PDF used to be baked into Drive and then edited around: the file a
-- client approved and a printer printed drifted from what the editor showed,
-- silently. Freezing the file only detected the drift; this removes it.
--
-- A proof is DATA: the spec, the mockup, and the item's facts at that moment.
-- Editing makes a new draft. Sending freezes it. Approval stamps it. An edit
-- after approval starts a new draft, so an approved version can never change.
-- The PDF is rendered ON DEMAND; the first time an approved version is
-- downloaded the file is kept and reused forever, as the evidence of sign-off.
create table if not exists public.proof_versions (
  id                    uuid primary key default gen_random_uuid(),
  item_id               uuid not null references public.items(id) on delete cascade,
  version               int  not null,
  state                 text not null default 'draft',      -- draft | sent | approved | superseded
  spec                  jsonb not null,                     -- the proof as data
  item_snapshot         jsonb,                              -- name, blank, colors… as they were
  mockup_drive_file_id  text,                               -- pre-cropped image the render uses
  renderer_version      int,
  pdf_drive_file_id     text,                               -- write-once: made on first download
  pdf_created_at        timestamptz,
  created_at            timestamptz not null default now(),
  created_by            uuid,
  sent_at               timestamptz,
  approved_at           timestamptz,
  approved_by           text,                               -- client contact or staff name
  approval_source       text,                               -- client | internal | carried
  superseded_at         timestamptz,
  note                  text,
  company_id            uuid,
  unique (item_id, version)
);

create index if not exists proof_versions_item_idx on public.proof_versions (item_id, version desc);
create index if not exists proof_versions_state_idx on public.proof_versions (state) where state in ('sent', 'approved');

alter table public.proof_versions enable row level security;

-- Same shape as the rest of the app's tables: authenticated staff read/write,
-- portals reach it through their own token-scoped routes (service role).
drop policy if exists "proof_versions authenticated" on public.proof_versions;
create policy "proof_versions authenticated" on public.proof_versions
  for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.proof_versions to authenticated;
grant select on public.proof_versions to anon;
