-- 174: menu_leads quote spine (Sep 9 2026) — the Quick Quote that turns a
-- menu lead into a production-ready job with no re-keying.
--
-- quote jsonb: { lines: [{styleCode, label, qty, colors[], unitPrice,
-- note}], punch: [{key, label, desc, kind, required, status, payload}],
-- validUntil, sentAt, acceptedAt, total }
--
-- Lines carry EXACT unit prices (they become items.sell_per_unit on
-- accept→job); punch 'sizes' payloads are per-colorway grids (they become
-- buy_sheet_lines) — the single-source money doctrine starts at the quote.
-- Status flow grows: quote_requested → quoted → accepted → converted.
alter table menu_leads add column if not exists quote jsonb;
alter table menu_leads add column if not exists quoted_at timestamptz;
alter table menu_leads add column if not exists accepted_at timestamptz;

notify pgrst, 'reload schema';
