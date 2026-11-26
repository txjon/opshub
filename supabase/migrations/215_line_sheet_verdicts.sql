-- LINE SHEET VERDICTS (Jon, Nov 26 2026). A thumbs-up was too broad: it meant
-- both "good as is" and "I like it, but change something". Three verdicts
-- replace the thumb, settable by the client AND by HPD:
--   asis   = good to go (the only thing Create order takes)
--   change = like it, change something (needs a note: what should change)
--   pass   = no
--   liked  = an old thumbs-up nobody has sorted yet: he's asked again
--            "As is, or change something?". Only this backfill writes it.
-- client_verdict_by says who set it ('client' | 'hpd').
--
-- Additive on purpose: prod still runs the thumb code until the deploy, so
-- client_thumb stays until mig 216 (which re-syncs any thumb made in between,
-- then drops it). Also flattens each sheet's order into ONE list (shelves are
-- retired; mig 216 drops them): shelf order, then position on the shelf, then
-- the tray. Relative order inside a shelf is unchanged, so prod reads the same.
alter table line_sheet_items
  add column if not exists client_verdict text check (client_verdict in ('asis', 'change', 'pass', 'liked')),
  add column if not exists client_verdict_at timestamptz,
  add column if not exists client_verdict_version int,
  add column if not exists client_verdict_by text check (client_verdict_by in ('client', 'hpd'));

update line_sheet_items set
  client_verdict = case client_thumb when 'up' then 'liked' when 'down' then 'pass' end,
  client_verdict_at = client_thumb_at,
  client_verdict_version = client_thumb_version,
  client_verdict_by = 'client'
where client_thumb is not null and client_verdict is null;

with o as (
  select i.id, row_number() over (partition by i.sheet_id order by (s.id is null), s.sort, i.sort, i.id) as rn
  from line_sheet_items i left join line_sheet_sections s on s.id = i.section_id
)
update line_sheet_items i set sort = o.rn * 10 from o where o.id = i.id;

notify pgrst, 'reload schema';
