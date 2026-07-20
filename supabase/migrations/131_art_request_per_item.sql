-- Per-item art quotes. The designer prices each item (screen count + price)
-- rather than one total for the whole request. quoted_items = array of
-- { item_id, item_name, amount, screens }. quoted_amount stays as the summed
-- total (for the email subject + the in-app summary line). See the OpsHub art
-- request feature (2026-07-20).
alter table art_requests
  add column if not exists quoted_items jsonb not null default '[]';
