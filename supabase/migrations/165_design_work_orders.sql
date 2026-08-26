-- 165: THE DESIGNER DOOR (Jon, Aug 26 2026) — Room 2 graduates out of the Lab
-- onto the real studio. A work order hangs off a REAL design (art_briefs), is
-- hard-walled from the client (the designer never sees who it's for), and
-- carries a PINNED BRIEF: reference images as canvases, numbered pins on each
-- ("replace the hammer with this pistol"), each pin optionally pointing at a
-- swap-in image. One JSON spec, rendered three ways (our editor, the designer's
-- read-only page, print). Kills the Freeform → PDF → Slack ritual.
--
-- Designer deliveries are REAL brief files (art_brief_files, uploader_role
-- 'designer', internal until we share) so everything lives where the files are.
-- lab_work_orders / lab_wo_messages (mig 148) stay as-is for the sandbox.

create table if not exists design_work_orders (
  id uuid primary key default gen_random_uuid(),
  brief_id uuid not null references art_briefs(id) on delete cascade,
  -- what we need made: creative (from scratch) / vector clean-up / separations
  type text not null check (type in ('creative','vector','separations')),
  title text,                                  -- denormalized design title (display + designer page)
  headline text,                               -- the one-line directive ("KEEP EXACT STYLE")
  instructions text,                           -- longer notes
  -- THE PINNED BRIEF. { canvases: [{ id, fileId, driveId, previewId, name,
  --   note, pins: [{ id, x, y, text, driveId, name }] }], extras: [{ fileId,
  --   driveId, previewId, name }] }  x/y are percentages of the image box.
  brief jsonb not null default '{"canvases":[],"extras":[]}',
  due_by date,
  designer_name text,
  designer_email text,
  token text not null unique,                  -- the designer's magic link
  -- loose state, derived from the thread. No dead-ends.
  state text not null default 'out' check (state in ('out','delivered','in_revision','accepted','killed')),
  accepted_file_id uuid references art_brief_files(id) on delete set null,
  sent_at timestamptz,                         -- email went out
  last_designer_at timestamptz,                -- their latest word/file
  last_hpd_at timestamptz,                     -- our latest word/file
  hpd_seen_at timestamptz,                     -- we last opened it (unread = last_designer_at > this)
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists design_work_orders_brief_idx on design_work_orders(brief_id, created_at desc);
create index if not exists design_work_orders_state_idx on design_work_orders(state);

create table if not exists design_wo_messages (
  id uuid primary key default gen_random_uuid(),
  work_order_id uuid not null references design_work_orders(id) on delete cascade,
  sender_role text not null check (sender_role in ('hpd','designer')),
  sender_name text,
  body text,
  file_id uuid references art_brief_files(id) on delete set null,  -- the real file row (Drive)
  file_url text,                               -- landing copy (storage) — never lost even if the Drive copy fails
  file_name text,
  kind text not null default 'comment' check (kind in ('comment','delivery','revision','accept')),
  created_at timestamptz not null default now()
);
create index if not exists design_wo_messages_wo_idx on design_wo_messages(work_order_id, created_at);

alter table design_work_orders enable row level security;
alter table design_wo_messages enable row level security;
-- No policies: service-role via /api/studio/* + the token-verified /api/designer/* routes.
