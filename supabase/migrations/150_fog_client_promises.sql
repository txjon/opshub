-- 150: seed FOG client-date PROMISES (items.client_eta, resurrected Jul 28).
--
-- client_eta's new meaning: THE PROMISE — the date we committed to the client.
-- When set it wins over the derived chain on every portal surface (essential
-- for retro-added jobs whose production dates are backfill). Values below are
-- Jon's original client commitments, dictated 2026-07-28 evening.
update items set client_eta = '2026-10-20'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2605-032'
  and items.name in ('Rain Jacket - Black', 'Rain Jacket - Grey');

update items set client_eta = '2026-09-23'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2605-064'
  and items.name = 'F Hat - Green Camo';

update items set client_eta = '2026-09-07'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2605-006'
  and items.name in ('Tan Folding Organizer', 'Black Folding Organizer', 'Large Dry Bag', 'Medium Dry Bag');

update items set client_eta = '2026-07-30'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2606-047'
  and items.name in ('Corporate Sports Bra', 'Corporate Slim Fit Tee', 'Corporate Crop Tee', 'Corporate Crop Hoodie');

update items set client_eta = '2026-07-30'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2604-008'
  and items.name = 'Nice Tote';

update items set client_eta = '2026-08-10'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2606-040'
  and items.name ilike '%Ridgeline Pant%';

update items set client_eta = '2026-08-04'
  from jobs j where items.job_id = j.id and j.job_number = 'HPD-2606-040'
  and items.name = 'Black Grupo Dad Hat';
