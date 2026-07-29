-- 152: split the Sticker Mule double-tracking box (HPD Web snake stickers).
-- Drake grouped 2 items under ONE box with both UPS numbers comma-pasted into
-- tracking ("1Z800E890239945409,1Z800E890221343011.") — live tracking can't
-- register a mangled string and the ledger rule is one box per waybill.
-- Split: lead box keeps ...409 + Snake Sticker Pack (80); new box gets ...011 +
-- Snake Ramp Sticker (20). Carton↔item assignment is assumed (noted on both).
update shipments set
  tracking = '1Z800E890239945409',
  group_key = 'f364747a-cadc-4be5-b4c2-99a17c061130::1Z800E890239945409',
  warehouse_notes = 'Split from a double-tracking entry — carton/item assignment assumed. Sibling box: 1Z800E890221343011.'
where id = '48910bf6-bbbd-46f8-82f9-7e7cbbdec93a';

insert into shipments (id, direction, source, decorator_id, group_key, carrier, tracking, pickup, expected_arrival, status, warehouse_notes)
values ('a3f6f7d2-9c41-4a58-8d15-2b6a01572901', 'inbound', 'decorator',
        'f364747a-cadc-4be5-b4c2-99a17c061130',
        'f364747a-cadc-4be5-b4c2-99a17c061130::1Z800E890221343011',
        'UPS', '1Z800E890221343011', false, '2026-07-30', 'expected',
        'Split from a double-tracking entry — carton/item assignment assumed. Sibling box: 1Z800E890239945409.');

update shipment_lines set shipment_id = 'a3f6f7d2-9c41-4a58-8d15-2b6a01572901'
where id = '83df8da1-a6bd-4c43-805c-4dceea3b75bc';

update movements set shipment_id = 'a3f6f7d2-9c41-4a58-8d15-2b6a01572901'
where id = '7ea01765-a876-47f3-bd64-7abee1e20c83';
