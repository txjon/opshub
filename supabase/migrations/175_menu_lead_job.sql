-- 175: menu_leads → jobs link (Quick Quote Q2, Sep 9 2026). The accepted
-- quote converts to a real job; the lead keeps the pointer for the
-- pipeline view and audit.
alter table menu_leads add column if not exists job_id uuid references jobs(id) on delete set null;

notify pgrst, 'reload schema';
