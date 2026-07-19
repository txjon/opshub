/* Reset the Playwright Test Co sandbox:
 *   1) DELETE every Playwright Test Co job + all children (full cascade incl. the
 *      movement ledger / shipments / payments / activity).
 *   2) SEED one fresh job with 4 costed items, left AT COSTING (pre-quote) so the
 *      test loop starts by sending the quote.
 *
 * Scoped strictly to the Playwright Test Co client_id — no broad predicates.
 *   Dry run (prints plan, no writes):  node scripts/reset-test-job.cjs
 *   Apply:                             node scripts/reset-test-job.cjs --apply
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CLIENT_ID = '8f2781f4-0b19-4d45-beca-29c0daadc4af'; // Playwright Test Co
const APPLY = process.argv.includes('--apply');
const NEW_TITLE = 'TEST — Loop Sandbox';

// 4 items across a route mix so the loop exercises every path:
//   ship_through (→HPD→forward), drop_ship (vendor→client), stage (→HPD→webstore).
const TARGETS = [
  { short: 'ICON',    route: 'ship_through' },
  { short: 'STOKED',  route: 'ship_through' },
  { short: 'STICKER', route: 'drop_ship' },
  { short: 'HP LABS', route: 'stage' },
];

const daysOut = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sumQ = (q) => Object.values(q || {}).reduce((a, v) => a + (+v || 0), 0);

async function collectDeletePlan() {
  const { data: jobs } = await sb.from('jobs').select('id, job_number, title, phase').eq('client_id', CLIENT_ID);
  const jobIds = (jobs || []).map(j => j.id);
  if (!jobIds.length) return { jobs: [], jobIds: [], itemIds: [], shipmentIds: [] };
  const { data: items } = await sb.from('items').select('id').in('job_id', jobIds);
  const itemIds = (items || []).map(i => i.id);
  let shipmentIds = [];
  if (itemIds.length) {
    const { data: lines } = await sb.from('shipment_lines').select('shipment_id').in('item_id', itemIds);
    shipmentIds = [...new Set((lines || []).map(l => l.shipment_id).filter(Boolean))];
  }
  return { jobs: jobs || [], jobIds, itemIds, shipmentIds };
}

async function del() {
  const plan = await collectDeletePlan();
  console.log(`\nDELETE PLAN (Playwright Test Co only):`);
  for (const j of plan.jobs) console.log(`  ${j.job_number}  ${j.phase.padEnd(11)} "${j.title}"  ${j.id}`);
  console.log(`  → ${plan.jobs.length} jobs, ${plan.itemIds.length} items, ${plan.shipmentIds.length} shipments (+ their movements/lines/payments/activity)`);
  if (!APPLY) return;
  if (!plan.jobIds.length) return;
  const { jobIds, itemIds, shipmentIds } = plan;
  const delIn = async (table, col, ids) => { if (!ids.length) return; const { error } = await sb.from(table).delete().in(col, ids); if (error) console.log(`    ⚠ ${table}.${col}: ${error.message}`); };

  if (itemIds.length) {
    await delIn('movements', 'item_id', itemIds);
    await delIn('shipment_lines', 'item_id', itemIds);
    await delIn('pulled_inventory', 'item_id', itemIds);
    await delIn('pull_requests', 'item_id', itemIds);
    await delIn('item_files', 'item_id', itemIds);
    await delIn('decorator_assignments', 'item_id', itemIds);
    await delIn('buy_sheet_lines', 'item_id', itemIds);
  }
  await delIn('movements', 'job_id', jobIds);            // any job-scoped movements w/o item
  await delIn('shipment_lines', 'job_id', jobIds);
  await delIn('payment_records', 'job_id', jobIds);
  await delIn('job_activity', 'job_id', jobIds);
  await delIn('job_contacts', 'job_id', jobIds);
  await delIn('items', 'job_id', jobIds);
  await delIn('shipments', 'id', shipmentIds);
  await delIn('jobs', 'id', jobIds);
  console.log(`  ✅ deleted.`);
}

async function seed() {
  const { data: cli } = await sb.from('clients').select('id, name, company_id').eq('id', CLIENT_ID).single();
  const companyId = cli?.company_id || null;

  const { data: decs } = await sb.from('decorators').select('id, name, short_code');
  const decByShort = {};
  for (const d of (decs || [])) if (d.short_code && !decByShort[d.short_code]) decByShort[d.short_code] = d;

  // candidate costProds from completed jobs (excluding the Playwright sandbox so
  // we never re-seed its own "... TEST" items), keyed by printVendor short
  const { data: jobs } = await sb.from('jobs').select('client_id, costing_data').eq('phase', 'complete');
  const pool = {};
  for (const j of (jobs || [])) {
    if (j.client_id === CLIENT_ID) continue;
    for (const cp of (j.costing_data?.costProds || [])) {
      const u = sumQ(cp.qtys);
      const sell = +cp._sellOverrideVal || +cp.unitPrice || 0;
      const blankOk = cp.blankCosts && Object.keys(cp.blankCosts).length > 0;
      if (!cp.printVendor || u < 6 || u > 300 || !(cp.sizes?.length) || !blankOk || !(sell > 0) || !cp.name) continue;
      (pool[cp.printVendor] ||= []).push({ cp, units: u, sell });
    }
  }
  for (const k of Object.keys(pool)) {
    const seen = new Set();
    pool[k] = pool[k].sort((a, b) => a.units - b.units).filter(x => !seen.has(x.cp.name) && seen.add(x.cp.name));
  }

  if (!APPLY) {
    console.log(`\nSEED PLAN (dry run): new job "${NEW_TITLE}", 4 items AT COSTING (quote NOT approved, no POs):`);
    for (const t of TARGETS) {
      const pick = (pool[t.short] || [])[0];
      console.log(`  ${pick ? '+' : '⚠ no candidate for'} [${t.short}] ${pick ? `"${pick.cp.name.replace(/( TEST)+$/i,'')} TEST" ${pick.units}u $${pick.sell} route=${t.route}` : `route=${t.route}`}`);
    }
    console.log(`\n(dry run — re-run with --apply to delete + seed)`);
    return;
  }

  // job — at costing: intake phase, quote NOT approved, no POs sent.
  // payment_terms MUST be set (from the client default) or the payment gate can
  // never be met — a null term makes paymentGateMet() return false even for a
  // fully-paid invoice, sticking the job on "Pending Payment".
  const { data: cliTerms } = await sb.from('clients').select('default_terms').eq('id', CLIENT_ID).single();
  const { data: job, error: jErr } = await sb.from('jobs').insert({
    client_id: CLIENT_ID, company_id: companyId, title: NEW_TITLE, job_type: 'brand',
    phase: 'intake', shipping_route: 'ship_through', quote_approved: false,
    payment_terms: cliTerms?.default_terms || 'prepaid',
    target_ship_date: daysOut(21),
  }).select('id, job_number').single();
  if (jErr) throw new Error('job insert: ' + jErr.message);

  const costProds = [];
  for (const t of TARGETS) {
    const pick = (pool[t.short] || [])[0];
    const dec = decByShort[t.short];
    if (!pick) { console.log(`  ⚠ ${t.short}: no candidate, skipping`); continue; }
    const { cp, sell, units } = pick;
    const name = `${cp.name.replace(/( TEST)+$/i, '')} TEST`;
    const { data: item, error: iErr } = await sb.from('items').insert({
      job_id: job.id, company_id: companyId, name,
      garment_type: cp.garment_type || 'tee', blank_vendor: cp.supplier || null,
      blank_costs: cp.blankCosts, sell_per_unit: sell,
      pipeline_stage: null,               // NOT in production — costed only
      shipping_route: t.route, artwork_status: null,
      qb_item_type: cp.qb_item_type || null,
    }).select('id').single();
    if (iErr) throw new Error('item insert: ' + iErr.message);
    const lines = cp.sizes.map(sz => ({ item_id: item.id, size: sz, qty_ordered: Math.round(+cp.qtys[sz] || 0) })).filter(l => l.qty_ordered > 0);
    if (lines.length) { const { error } = await sb.from('buy_sheet_lines').insert(lines); if (error) throw new Error('bsl: ' + error.message); }
    if (dec) {
      // link the vendor (so PO tab knows it) but keep it pre-production
      const { error: aErr } = await sb.from('decorator_assignments').insert({ item_id: item.id, decorator_id: dec.id, pipeline_stage: null });
      if (aErr) console.log(`    ⚠ assignment ${t.short}: ${aErr.message}`);
    }
    costProds.push({ ...cp, id: item.id, name, printVendor: t.short, _sellOverride: true, _sellOverrideVal: sell });
    console.log(`  + [${t.short}] "${name}" ${units}u $${sell} route=${t.route}`);
  }

  const grossRev = costProds.reduce((a, cp) => a + (+cp._sellOverrideVal || 0) * sumQ(cp.qtys), 0);
  const totalQty = costProds.reduce((a, cp) => a + sumQ(cp.qtys), 0);
  const totalCost = costProds.reduce((a, cp) => a + Object.entries(cp.qtys || {}).reduce((x, [sz, q]) => x + (+(cp.blankCosts?.[sz]) || 0) * (+q || 0), 0), 0);
  const netProfit = grossRev - totalCost;

  const { error: uErr } = await sb.from('jobs').update({
    costing_data: { costProds, costMargin: 0, inclShip: false, inclCC: false, orderInfo: {} },
    costing_summary: { margin: grossRev ? (netProfit / grossRev) * 100 : 0, grossRev, totalQty, netProfit, totalCost, avgPerUnit: totalQty ? grossRev / totalQty : 0 },
    type_meta: { po_sent_vendors: [], costing_locked: false },   // NO POs sent
  }).eq('id', job.id);
  if (uErr) throw new Error('job update: ' + uErr.message);

  console.log(`\n✅ Seeded ${job.job_number} (${job.id}): ${costProds.length} items AT COSTING · $${grossRev.toFixed(2)} · ${totalQty} units · quote NOT sent.`);
  console.log(`   Open: /jobs/${job.id}  → send the quote to start the loop.`);
}

(async () => {
  try { await del(); await seed(); }
  catch (e) { console.error('RESET FAILED:', e.message); process.exit(1); }
})();
