-- 194: payment reminders on fulfillment invoices (Jon, Oct 1 2026 — the
-- $100k FOG postage invoice had no reminder path). Stamped by
-- /api/email/shipstation-report when sent with reminder:true; sent_at stays
-- the ORIGINAL send (aging + "Sent" read it). Additive only.
alter table shipstation_reports add column if not exists last_reminded_at timestamptz;
notify pgrst, 'reload schema';
