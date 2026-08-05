-- 159: ONE state vocabulary for the studio (Phase 1 map, Jon signed Aug 4).
-- The old ladder (10 step-states) collapses onto the Lab's five: state =
-- WHOSE COURT, not which step. The conversation carries the nuance.
--   draft/sent/in_progress/wip_review/revisions/pending_prep → working
--   client_review                                            → with_client
--   final_approved/production_ready/delivered                → approved
--   (new)                                                    → shelved, killed
-- Plus the thumbs seam: reactions live on brief FILES, the approved pin
-- records exactly which version got banked, message visibility becomes the
-- two-value wall, and order requests learn to attach to briefs.

-- drop the old 10-state constraint FIRST — the rewrite writes values it
-- doesn't allow
alter table art_briefs drop constraint if exists art_briefs_state_check;

update art_briefs set state = case
  when state in ('draft','sent','in_progress','wip_review','revisions','pending_prep') then 'working'
  when state = 'client_review' then 'with_client'
  when state in ('final_approved','production_ready','delivered') then 'approved'
  else state end
where state not in ('working','with_client','approved','shelved','killed');

alter table art_briefs add constraint art_briefs_state_check
  check (state in ('working','with_client','approved','shelved','killed'));
alter table art_briefs alter column state set default 'working';

alter table art_brief_files add column if not exists reaction text;
alter table art_briefs add column if not exists approved_file_id uuid references art_brief_files(id) on delete set null;

alter table art_brief_messages drop constraint if exists art_brief_messages_visibility_check;
update art_brief_messages set visibility = case when visibility = 'all' then 'client' else 'internal' end
where visibility not in ('client','internal');
alter table art_brief_messages add constraint art_brief_messages_visibility_check
  check (visibility in ('client','internal'));
alter table art_brief_messages alter column visibility set default 'client';

alter table lab_order_requests add column if not exists brief_id uuid references art_briefs(id) on delete cascade;
