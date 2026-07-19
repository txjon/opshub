/* Seed ONE fully-populated TEST job for walking the V2 job-detail surfaces.
 * Lights every status-bar gate (Quote+Proofs → Approved → Invoice → Paid →
 * PO/Blanks → Production) and every gallery item-status, plus a proof in
 * revision to exercise the revision loop.
 *
 * Real costProds + copied art files (real Drive thumbnails) pulled from
 * completed jobs, under the Playwright Test Co client. Harmless — flagged is_test.
 *
 * Run:   node scripts/seed-v2-test-job.cjs
 * Undo:  node scripts/seed-v2-test-job.cjs --delete
 */
require('dotenv').config({ path: '/Users/jonburrow/opshub/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const CLIENT_ID = '8f2781f4-0b19-4d45-beca-29c0daadc4af'; // Playwright Test Co
const TITLE = 'TEST — V2 Job Detail';
const QB_NUM = 'T-4402';

// One profile per item → drives gallery status + proof state + tail data.
const PROFILES = [
  { route: 'ship_through', method: 'UPS Ground',      stage: 'in_production', proof: 'approved' },
  { route: 'ship_through', method: 'UPS Ground',      stage: 'shipped',       proof: 'approved', shipped: true },
  { route: 'ship_through', method: 'UPS Ground',      stage: 'shipped',       proof: 'approved', shipped: true, received: true },
  { route: 'ship_through', method: 'UPS Ground',      stage: 'shipped',       proof: 'approved', shipped: true, received: true, forwarded: true },
  { route: 'ship_through', method: 'UPS Ground',      stage: 'in_production', proof: 'pending' },
  { route: 'drop_ship',    method: "Vendor's Choice", stage: 'in_production', proof: 'revision_requested', revisionNote: 'Logo too small — enlarge ~15% and re-send' },
];

const daysOut = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const iso = (n) => { const d = new Date(); d.setUTCDate(d.getUTCDate() + n); return d.toISOString(); };
const units = (qtys) => Object.values(qtys || {}).reduce((a, v) => a + (+v || 0), 0);

async function findExisting() {
  const { data } = await sb.from('jobs').select('id, job_number').eq('client_id', CLIENT_ID).eq('title', TITLE);
  return (data || [])[0] || null;
}

async function del() {
  const job = await findExisting();
  if (!job) { console.log('No seeded job to delete.'); return; }
  const { data: items } = await sb.from('items').select('id').eq('job_id', job.id);
  const ids = (items || []).map(i => i.id);
  if (ids.length) {
    await sb.from('item_files').delete().in('item_id', ids);
    await sb.from('buy_sheet_lines').delete().in('item_id', ids);
    await sb.from('decorator_assignments').delete().in('item_id', ids);
    await sb.from('items').delete().in('id', ids);
  }
  await sb.from('payment_records').delete().eq('job_id', job.id);
  await sb.from('job_contacts').delete().eq('job_id', job.id);
  await sb.from('jobs').delete().eq('id', job.id);
  console.log(`Deleted ${job.job_number} (${job.id}) + ${ids.length} items and children.`);
}

async function seed() {
  if (await findExisting()) { console.log('Already exists. Run with --delete first.'); return; }

  const { data: cli } = await sb.from('clients').select('company_id').eq('id', CLIENT_ID).single();
  const companyId = cli?.company_id || null;

  // decorators by short_code
  const { data: decs } = await sb.from('decorators').select('id, short_code');
  const decByShort = {};
  for (const d of decs || []) if (d.short_code && !decByShort[d.short_code]) decByShort[d.short_code] = d;

  // candidate costProds from completed jobs (real costing structure)
  const { data: jobs } = await sb.from('jobs').select('costing_data').eq('phase', 'complete');
  const cands = [];
  const seen = new Set();
  for (const j of jobs || []) {
    for (const cp of (j.costing_data?.costProds || [])) {
      const u = units(cp.qtys);
      const sell = +cp._sellOverrideVal || +cp.unitPrice || 0;
      const blankOk = cp.blankCosts && Object.keys(cp.blankCosts).length > 0;
      if (!cp.printVendor || !decByShort[cp.printVendor] || u < 6 || u > 400) continue;
      if (!cp.sizes?.length || !blankOk || !(sell > 0) || !cp.name || !cp.id) continue;
      if (seen.has(cp.name)) continue;
      seen.add(cp.name);
      cands.push({ cp, units: u, sell, donorId: cp.id });
    }
  }
  cands.sort((a, b) => a.units - b.units);

  // keep only candidates whose donor item has copyable art (mockup/proof)
  const donorIds = cands.map(c => c.donorId);
  const { data: files } = await sb.from('item_files').select('item_id, stage, drive_file_id, drive_link, file_name, mime_type, file_size')
    .in('item_id', donorIds).is('superseded_at', null);
  const filesByDonor = {};
  for (const f of files || []) (filesByDonor[f.item_id] ||= []).push(f);
  const withArt = cands.filter(c => (filesByDonor[c.donorId] || []).some(f => ['mockup', 'proof', 'print_ready'].includes(f.stage)));

  const picks = withArt.slice(0, PROFILES.length);
  if (picks.length < PROFILES.length) { console.log(`Only ${picks.length} candidates with art — need ${PROFILES.length}.`); return; }

  // create job
  const { data: job, error: jErr } = await sb.from('jobs').insert({
    client_id: CLIENT_ID, company_id: companyId, title: TITLE, job_type: 'brand',
    phase: 'production', payment_terms: 'net_30', shipping_route: 'ship_through',
    quote_approved: true, quote_approved_at: iso(-5), target_ship_date: daysOut(10), is_test: true,
  }).select('id, job_number').single();
  if (jErr) throw new Error('job: ' + jErr.message);
  console.log(`Created ${job.job_number} (${job.id})`);

  const costProds = [];
  const sentShorts = new Set();
  const poSentDates = {}, poShipDates = {}, poShipMethods = {};
  let etaOffset = 4, blankTotalAll = 0;

  for (let i = 0; i < picks.length; i++) {
    const { cp, sell } = picks[i];
    const p = PROFILES[i];
    const dec = decByShort[cp.printVendor];
    const name = `${cp.name} TEST`;
    const qtys = cp.qtys || {};
    const blankTotal = Object.entries(qtys).reduce((a, [sz, q]) => a + (+(cp.blankCosts?.[sz]) || 0) * (+q || 0), 0);
    blankTotalAll += blankTotal;
    sentShorts.add(cp.printVendor);
    poSentDates[cp.printVendor] = daysOut(-4);
    poShipDates[cp.printVendor] = daysOut(etaOffset); etaOffset += 2;
    poShipMethods[cp.printVendor] = p.method;

    // items.artwork_status is a coarse gate ('approved' | 'not_started'); the real
    // per-proof state (pending / revision_requested) lives on item_files.approval.
    const artwork = p.proof === 'approved' ? 'approved' : 'not_started';
    const itemRow = {
      job_id: job.id, company_id: companyId, name, sort_order: i,
      garment_type: cp.garment_type || 'tee', blank_vendor: cp.supplier || null,
      blank_costs: cp.blankCosts, sell_per_unit: sell, qb_item_type: cp.qb_item_type || null,
      pipeline_stage: p.stage, shipping_route: p.route, artwork_status: artwork,
      blanks_order_number: `SS-TEST-${1000 + i}`, blanks_order_cost: Math.round(blankTotal * 100) / 100,
    };
    if (p.shipped) { itemRow.ship_qtys = qtys; itemRow.ship_tracking = `1ZTEST${i}SHIP`; }
    if (p.received) { itemRow.received_at_hpd = true; itemRow.received_at_hpd_at = iso(-2); itemRow.received_qtys = qtys; }
    if (p.forwarded) { itemRow.forwarded_at = iso(-1); itemRow.forward_tracking = `1ZTEST${i}FWD`; }

    const { data: item, error: iErr } = await sb.from('items').insert(itemRow).select('id').single();
    if (iErr) throw new Error('item: ' + iErr.message);

    // buy_sheet_lines
    const lines = cp.sizes.map(sz => {
      const q = Math.round(+qtys[sz] || 0);
      const l = { item_id: item.id, size: sz, qty_ordered: q };
      if (p.shipped) l.qty_shipped_from_vendor = q;
      if (p.received) l.qty_received_at_hpd = q;
      return l;
    }).filter(l => l.qty_ordered > 0);
    if (lines.length) { const { error } = await sb.from('buy_sheet_lines').insert(lines); if (error) throw new Error('bsl: ' + error.message); }

    // decorator assignment
    const { error: aErr } = await sb.from('decorator_assignments').insert({
      item_id: item.id, decorator_id: dec.id, pipeline_stage: p.stage, sent_to_decorator_date: daysOut(-4),
      tracking_number: p.shipped ? `1ZTEST${i}SHIP` : null,
    });
    if (aErr) throw new Error('assignment: ' + aErr.message);

    // copy art files (mockup + proof) → real Drive thumbnails
    const donorFiles = (filesByDonor[picks[i].donorId] || []).filter(f => ['mockup', 'proof'].includes(f.stage));
    const seenStage = new Set();
    const toInsert = [];
    for (const f of donorFiles) {
      if (seenStage.has(f.stage)) continue; seenStage.add(f.stage);
      const row = {
        item_id: item.id, file_name: f.file_name, stage: f.stage, drive_file_id: f.drive_file_id,
        drive_link: f.drive_link || `https://drive.google.com/file/d/${f.drive_file_id}/view`,
        mime_type: f.mime_type || null, file_size: f.file_size || null, approval: 'none',
      };
      if (f.stage === 'proof') {
        row.approval = p.proof;
        if (p.proof === 'approved') row.approved_at = iso(-4);
        if (p.proof === 'revision_requested') row.notes = p.revisionNote;
      }
      toInsert.push(row);
    }
    if (toInsert.length) { const { error } = await sb.from('item_files').insert(toInsert); if (error) throw new Error('files: ' + error.message); }

    costProds.push({ ...cp, id: item.id, name, _sellOverride: true, _sellOverrideVal: sell });
    console.log(`  + "${name}"  ${units(qtys)}u $${sell}  ${p.stage}/${p.route}  proof=${p.proof}  (${toInsert.length} files)`);
  }

  // costing summary
  const grossRev = costProds.reduce((a, cp) => a + (+cp._sellOverrideVal || 0) * units(cp.qtys), 0);
  const totalQty = costProds.reduce((a, cp) => a + units(cp.qtys), 0);
  const netProfit = grossRev - blankTotalAll;
  const tax = Math.round(grossRev * 0.0838 * 100) / 100; // ~Las Vegas rate, illustrative

  await sb.from('jobs').update({
    costing_data: { costProds, costMargin: 0, inclShip: false, inclCC: false, orderInfo: {} },
    costing_summary: { margin: grossRev ? (netProfit / grossRev) * 100 : 0, grossRev, totalQty, netProfit, totalCost: blankTotalAll, avgPerUnit: totalQty ? grossRev / totalQty : 0 },
    type_meta: {
      quote_sent_at: iso(-6),
      qb_invoice_number: QB_NUM, qb_invoice_id: 'TEST-INV-4402',
      qb_payment_link: 'https://connect.intuit.com/pay/TEST', qb_tax_amount: tax, qb_total_with_tax: grossRev + tax,
      po_sent_vendors: [...sentShorts], po_sent_dates: poSentDates, po_ship_dates: poShipDates, po_ship_methods: poShipMethods,
      costing_locked: true,
    },
  }).eq('id', job.id);

  // payments: deposit paid + balance sent (Net 30 on account)
  const deposit = Math.round(grossRev * 0.3 * 100) / 100;
  const total = Math.round((grossRev + tax) * 100) / 100;
  // payment_records.status constraint = paid | pending | void
  const { error: pErr } = await sb.from('payment_records').insert([
    { job_id: job.id, company_id: companyId, type: 'deposit', amount: deposit, status: 'paid', invoice_number: QB_NUM, qb_invoice_id: 'TEST-INV-4402', paid_date: daysOut(-3), due_date: daysOut(-6) },
    { job_id: job.id, company_id: companyId, type: 'balance', amount: Math.round((total - deposit) * 100) / 100, status: 'pending', invoice_number: QB_NUM, qb_invoice_id: 'TEST-INV-4402', due_date: daysOut(24) },
  ]);
  if (pErr) throw new Error('payments: ' + pErr.message);

  // contacts: reuse the client's two existing contacts (primary + billing)
  const { data: contacts } = await sb.from('contacts').select('id').eq('client_id', CLIENT_ID).limit(2);
  const roles = ['primary', 'billing'];
  const jc = (contacts || []).map((c, idx) => ({ job_id: job.id, contact_id: c.id, role_on_job: roles[idx] || 'cc', notify: true }));
  if (jc.length) await sb.from('job_contacts').insert(jc);

  console.log(`\n✅ ${job.job_number}: ${costProds.length} items · gross $${grossRev.toFixed(2)} · ${totalQty} units · QB ${QB_NUM}`);
  console.log(`   Deposit paid $${deposit.toFixed(2)} · balance $${(total - deposit).toFixed(2)} due ${daysOut(24)}`);
  console.log(`   Open: /jobs/${job.id}`);
}

(async () => {
  try {
    if (process.argv.includes('--delete')) await del();
    else await seed();
  } catch (e) { console.error('FAILED:', e.message); process.exit(1); }
})();
