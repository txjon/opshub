-- 173: menu_leads response tracking — the one-click tailored response
-- (P3 of the intake menu). Stores what was sent so the thread survives
-- staff turnover and the lead card shows what the customer was told.
alter table menu_leads add column if not exists responded_at timestamptz;
alter table menu_leads add column if not exists response jsonb;

notify pgrst, 'reload schema';
