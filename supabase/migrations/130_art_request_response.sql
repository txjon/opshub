-- Structured response for an art pricing request. The designer submits a
-- price + screen count (+ optional note) on the gallery instead of replying by
-- email. status flips 'sent' -> 'quoted'. The price is still applied to the
-- quote manually as an Additional charge (owner keeps control). See the OpsHub
-- art request feature (2026-07-20).
alter table art_requests
  add column if not exists quoted_amount  numeric,
  add column if not exists quoted_screens integer,
  add column if not exists quoted_note    text,
  add column if not exists responded_at   timestamptz;
