-- 195: optional "why" on a client's thumbs-down (Jon, Oct 1 2026). Never
-- required; lives with the thumb (cleared when the thumb changes away from
-- down or resets on new art). Additive only.
alter table line_sheet_items add column if not exists client_thumb_note text;
notify pgrst, 'reload schema';
