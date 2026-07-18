-- 126: QB Bill paid-status (roadmap Tier 2, parking-lot item #4 — Jon).
-- webhook2 now processes BillPayment events; when QB records payment of a
-- pushed AP bill, the entries/pay-run it came from get stamped paid.
alter table cost_entries add column if not exists qb_paid_at timestamptz;
alter table contractor_pay_runs add column if not exists qb_paid_at timestamptz;
