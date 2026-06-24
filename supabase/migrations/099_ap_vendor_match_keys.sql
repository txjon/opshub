-- 099: one payable vendor can map to MULTIPLE costing vendors. Teeland bills as
-- one vendor but is set up as two costing decorators (Screen + Embroidery) for
-- the two price structures. ap_vendors.decorator_id (1:1) can't express that, so
-- expected-cost matching missed half the job. Add match_keys[] = the printVendor
-- keys (decorator short_code||name, upper) an AP vendor's invoices cover.

alter table ap_vendors add column if not exists match_keys text[];

-- Backfill: each seeded vendor covers its own decorator's printVendor key.
update ap_vendors av
set match_keys = array[upper(coalesce(d.short_code, d.name))]
from decorators d
where av.decorator_id = d.id
  and (av.match_keys is null or array_length(av.match_keys, 1) is null);

-- Teeland = ONE payable vendor billing both screen + embroidery. Collapse the two
-- costing vendors into one AP vendor that covers both keys; drop the redundant row.
update ap_vendors set name = 'Teeland', match_keys = array['TEELAND SCREEN', 'TEELAND - EMB']
where decorator_id = (select id from decorators where short_code = 'TEELAND SCREEN' limit 1);
delete from ap_vendors
where decorator_id = (select id from decorators where short_code = 'TEELAND - EMB' limit 1);

-- Icon has a duplicate decorator record (both short_code 'ICON'). Both seed an AP
-- vendor with the same key, so expected-cost is fine — just collapse to one row to
-- de-clutter the picker. Keep the earliest, deactivate the rest, normalize name.
update ap_vendors set active = false
where decorator_id in (select id from decorators where short_code = 'ICON')
  and id <> (select av.id from ap_vendors av join decorators d on d.id = av.decorator_id
             where d.short_code = 'ICON' order by av.created_at limit 1);
update ap_vendors set name = 'Icon'
where active = true and decorator_id in (select id from decorators where short_code = 'ICON');
