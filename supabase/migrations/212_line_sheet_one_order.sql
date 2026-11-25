-- One live order per line sheet (Nov 2026): two presses of "Create order" at
-- once (two tabs, two people) must not birth two jobs. The order route catches
-- the conflict and adds to the existing job instead.
create unique index if not exists jobs_one_order_per_line_sheet
  on jobs ((type_meta->>'line_sheet_id'))
  where type_meta ? 'line_sheet_id' and phase <> 'cancelled';
