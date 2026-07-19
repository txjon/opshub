/* Seed a diverse, multi-vendor TEST job for the Playwright Test Co client,
 * set up "costing done" and dropped onto the production board (items in_production,
 * POs marked sent — NO emails). Pulls real costProds from completed jobs.
 *
 * Run:  node scripts/seed-test-job.cjs
 * Undo: node scripts/seed-test-job.cjs --delete   (removes the seeded job + children)
 *
 * Exercises: job×vendor strips, mixed routes (ship_through + drop_ship),
 * One Stop consolidation (2 items → Build-shipment), a Pick-Up vendor, arrival ETAs.
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CLIENT_ID = '8f2781f4-0b19-4d45-beca-29c0daadc4af'; // Playwright Test Co
const TITLE = 'TEST — Multi-Vendor Production';

// Which vendors (by short_code / printVendor) to include, their per-item route,
// pickup flag, and how many items to pull from that vendor. Order = display order.
const TARGETS = [
  { short: 'ICON',           route: 'ship_through', method: 'UPS Ground',     count: 1 },
  { short: 'STOKED',         route: 'ship_through', method: 'UPS Ground',     count: 1 },
  { short: '1 STOP',         route: 'ship_through', method: 'UPS Ground',     count: 2 }, // consolidation
  { short: 'TEELAND SCREEN', route: 'ship_through', method: 'Pick Up',        count: 1 }, // pickup
  { short: 'STICKER',        route: 'drop_ship',    method: "Vendor's Choice",count: 1 }, // direct to client
  { short: 'HP LABS',        route: 'ship_through', method: 'UPS Ground',     count: 1 }, // in-house
];

const daysOut = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function findExisting() {
  const { data } = await sb.from('jobs').select('id, job_number, title').eq('client_id', CLIENT_ID).eq('title', TITLE);
  return (data || [])[0] || null;
}

async function del() {
  const job = await findExisting();
  if (!job) { console.log('No seeded job to delete.'); return; }
  const { data: items } = await sb.from('items').select('id').eq('job_id', job.id);
  const itemIds = (items || []).map(i => i.id);
  if (itemIds.length) {
    await sb.from('buy_sheet_lines').delete().in('item_id', itemIds);
    await sb.from('decorator_assignments').delete().in('item_id', itemIds);
    await sb.from('items').delete().in('id', itemIds);
  }
  await sb.from('jobs').delete().eq('id', job.id);
  console.log(`Deleted seeded job ${job.job_number} (${job.id}) + ${itemIds.length} items.`);
}

async function seed() {
  const existing = await findExisting();
  if (existing) { console.log(`Already exists: ${existing.job_number} (${existing.id}). Run with --delete first to reseed.`); return; }

  // company_id for the Playwright client (multi-tenant)
  const { data: cli } = await sb.from('clients').select('id, name, company_id').eq('id', CLIENT_ID).single();
  const companyId = cli?.company_id || null;
  console.log(`Client: ${cli?.name} | company_id: ${companyId}`);

  // decorators: short_code -> id (first match wins on dups, e.g. the two ICONs)
  const { data: decs } = await sb.from('decorators').select('id, name, short_code');
  const decByShort = {};
  for (const d of (decs || [])) if (d.short_code && !decByShort[d.short_code]) decByShort[d.short_code] = d;

  // candidate pool: valid costProds from completed jobs, keyed by printVendor short
  const { data: jobs } = await sb.from('jobs').select('id, costing_data').eq('phase', 'complete');
  const pool = {};
  for (const j of (jobs || [])) {
    for (const cp of (j.costing_data?.costProds || [])) {
      const u = Object.values(cp.qtys || {}).reduce((a, v) => a + (+v || 0), 0);
      const sell = +cp._sellOverrideVal || +cp.unitPrice || 0;
      const blankOk = cp.blankCosts && Object.keys(cp.blankCosts).length > 0;
      if (!cp.printVendor || u < 6 || u > 400 || !(cp.sizes?.length) || !blankOk || !(sell > 0) || !cp.name) continue;
      (pool[cp.printVendor] ||= []).push({ cp, units: u, sell });
    }
  }
  // smallest-units first per vendor + de-dupe by name → manageable, distinct test items
  for (const k of Object.keys(pool)) {
    const seen = new Set();
    pool[k] = pool[k].sort((a, b) => a.units - b.units).filter(x => !seen.has(x.cp.name) && seen.add(x.cp.name));
  }

  // 1) Insert the job (job_number auto-assigned by trigger)
  const { data: job, error: jErr } = await sb.from('jobs').insert({
    client_id: CLIENT_ID, company_id: companyId, title: TITLE, job_type: 'brand',
    phase: 'production', shipping_route: 'ship_through', quote_approved: true,
    target_ship_date: daysOut(14),
  }).select('id, job_number').single();
  if (jErr) throw new Error('job insert: ' + jErr.message);
  console.log(`\nCreated job ${job.job_number} (${job.id})`);

  const costProds = [];
  const sentShorts = [];
  const poShipDates = {}, poShipMethods = {}, poSentDates = {};
  let etaOffset = 4;

  for (const t of TARGETS) {
    const picks = (pool[t.short] || []).slice(0, t.count);
    const dec = decByShort[t.short];
    if (!dec) { console.log(`  ⚠ no decorator for short '${t.short}', skipping`); continue; }
    if (!picks.length) { console.log(`  ⚠ ${t.short}: no candidates, skipping (no phantom vendor)`); continue; }
    if (picks.length < t.count) console.log(`  ⚠ ${t.short}: only ${picks.length}/${t.count} candidates`);
    sentShorts.push(t.short);
    poSentDates[t.short] = daysOut(0);
    poShipDates[t.short] = daysOut(etaOffset); etaOffset += 3;
    poShipMethods[t.short] = t.method;

    for (const { cp, sell, units } of picks) {
      const name = `${cp.name} TEST`;
      // item
      const { data: item, error: iErr } = await sb.from('items').insert({
        job_id: job.id, company_id: companyId, name,
        garment_type: cp.garment_type || 'tee', blank_vendor: cp.supplier || null,
        blank_costs: cp.blankCosts, sell_per_unit: sell, pipeline_stage: 'in_production',
        shipping_route: t.route, artwork_status: 'approved', qb_item_type: cp.qb_item_type || null,
      }).select('id').single();
      if (iErr) throw new Error('item insert: ' + iErr.message);
      // buy_sheet_lines (the source of sizes/qtys on the board)
      const lines = cp.sizes.map(sz => ({ item_id: item.id, size: sz, qty_ordered: Math.round(+cp.qtys[sz] || 0) }))
        .filter(l => l.qty_ordered > 0);
      if (lines.length) { const { error } = await sb.from('buy_sheet_lines').insert(lines); if (error) throw new Error('bsl: ' + error.message); }
      // decorator assignment (vendor strip grouping + in_production)
      const { error: aErr } = await sb.from('decorator_assignments').insert({
        item_id: item.id, decorator_id: dec.id, pipeline_stage: 'in_production',
        sent_to_decorator_date: daysOut(0),
      });
      if (aErr) throw new Error('assignment: ' + aErr.message);
      // costProd for costing_data (fixed sell so the Costing tab won't recompute weirdly)
      costProds.push({ ...cp, id: item.id, name, printVendor: t.short, _sellOverride: true, _sellOverrideVal: sell });
      console.log(`  + [${t.short}] "${name}" ${units}u $${sell} route=${t.route}${t.method === 'Pick Up' ? ' (PICKUP)' : ''}`);
    }
  }

  // costing summary (Costing tab recomputes on open; this is a sane starting point)
  const grossRev = costProds.reduce((a, cp) => a + (+cp._sellOverrideVal || 0) * Object.values(cp.qtys || {}).reduce((x, v) => x + (+v || 0), 0), 0);
  const totalQty = costProds.reduce((a, cp) => a + Object.values(cp.qtys || {}).reduce((x, v) => x + (+v || 0), 0), 0);
  const totalCost = costProds.reduce((a, cp) => a + Object.entries(cp.qtys || {}).reduce((x, [sz, q]) => x + (+(cp.blankCosts?.[sz]) || 0) * (+q || 0), 0), 0);
  const netProfit = grossRev - totalCost;

  const { error: uErr } = await sb.from('jobs').update({
    costing_data: { costProds, costMargin: 0, inclShip: false, inclCC: false, orderInfo: {} },
    costing_summary: { margin: grossRev ? (netProfit / grossRev) * 100 : 0, grossRev, totalQty, netProfit, totalCost, avgPerUnit: totalQty ? grossRev / totalQty : 0 },
    type_meta: {
      po_sent_vendors: sentShorts, po_sent_dates: poSentDates,
      po_ship_dates: poShipDates, po_ship_methods: poShipMethods,
      costing_locked: false,
    },
  }).eq('id', job.id);
  if (uErr) throw new Error('job update: ' + uErr.message);

  console.log(`\n✅ Seeded ${job.job_number}: ${costProds.length} items across ${sentShorts.length} vendors (${sentShorts.join(', ')})`);
  console.log(`   grossRev $${grossRev.toFixed(2)} | ${totalQty} units`);
  console.log(`   Open: /jobs/${job.id}  ·  board: /production`);
}

(async () => {
  try {
    if (process.argv.includes('--delete')) await del();
    else await seed();
  } catch (e) { console.error('SEED FAILED:', e.message); process.exit(1); }
})();
