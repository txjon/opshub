-- 133 — Client-shaped product spec on ideas (Studio build-it-out, Jul 21).
--
-- art_briefs.product_spec jsonb — the client's own commercial shaping of an
-- idea, editable from the hub Studio: { retail: number, model: 'stock' |
-- 'preorder', format: text, run_size: number, notes: text }. All optional —
-- prompts, not forms. Feeds the Drop planner later (a specced idea is a
-- slottable candidate).

alter table art_briefs add column if not exists product_spec jsonb not null default '{}';

comment on column art_briefs.product_spec is
  'Client-editable commercial spec from the hub Studio: retail, model (stock|preorder), format, run_size, notes.';
