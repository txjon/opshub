-- Phase 3: QB Bill push. Track which OpsHub cost entries have been pushed to
-- QuickBooks as a Bill, so the board can show a "✓ in QB" badge and the push
-- route can refuse to double-post. qb_vendor_id / default_expense_account on
-- ap_vendors already exist (migration 098) — populated lazily on first push.
alter table cost_entries add column if not exists qb_bill_id text;
alter table cost_entries add column if not exists qb_pushed_at timestamptz;
