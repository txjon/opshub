-- 153: doc_links — tokenized magic links for client-facing documents
-- (prospectuses). Unguessable /d/[token] URLs replace the直 public file paths
-- (Jon, Jul 29: "I don't want it to be this easy to find"). Service-role only
-- (RLS on, no policies — the lab/work-order pattern). opened_count/last_opened
-- give a lightweight read on whether a prospect actually looked.
create table if not exists doc_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  doc text not null,               -- filename under public/, e.g. hpd-partnership-overview.html
  label text,                      -- who/what this link is for ("general", a prospect name)
  created_at timestamptz not null default now(),
  opened_count int not null default 0,
  last_opened_at timestamptz
);
alter table doc_links enable row level security;

insert into doc_links (token, doc, label) values
  ('pt-4e0a7c1f9b2d4e6a8c3f5b7d9e1a3c5f', 'hpd-partnership-overview.html', 'general — partnership overview'),
  ('mf-8b2e6d4a0c9f1e3b5d7a9c2e4f6b8d0a', 'hpd-manufacturing-overview.html', 'general — manufacturing overview (draft)')
on conflict (token) do nothing;

-- Data API grants (new-table default: no PostgREST access without explicit
-- GRANTs) + schema cache reload so the API sees the table immediately.
grant all on doc_links to service_role;
notify pgrst, 'reload schema';
