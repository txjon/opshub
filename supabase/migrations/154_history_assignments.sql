-- 154: history_assignments — Jon's hand product-group assignments for the QB
-- history import, moved off ~/opshub-history/assignments.json so the NIGHTLY
-- history sync (cron, Vercel) can apply them. Keyed "doc_num|description";
-- manual truth beats keyword resolution on every re-import.
create table if not exists history_assignments (
  key text primary key,
  product_group text not null,
  created_at timestamptz not null default now()
);
alter table history_assignments enable row level security;
grant all on history_assignments to service_role;
notify pgrst, 'reload schema';
