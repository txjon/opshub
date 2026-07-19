require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const JOB = '8f1b8bd8-ba05-4276-aec7-a96bb80848c3';
const APPLY = process.argv.includes('--apply');

// name, vendor short_code, per-size qtys  (all ship_through, in production)
const NEW = [
  { name: 'Wave Tee TEST',   short: 'ICON',   qtys: { S:15, M:15, L:15, XL:15 }, sell: 22 }, // partial waves
  { name: 'Combo A TEST',    short: 'STOKED', qtys: { M:10, L:10 },              sell: 20 }, // consolidation pair
  { name: 'Combo B TEST',    short: 'STOKED', qtys: { M:10, L:10 },              sell: 20 }, // consolidation pair
  { name: 'Pull Tee TEST',   short: 'ICON',   qtys: { S:10, M:10, L:10, XL:10 }, sell: 24 }, // pull / hold-back
  { name: 'Return Tee TEST', short: 'STOKED', qtys: { S:8, M:8, L:8 },           sell: 18 }, // returns + edit
];
const sizesOf = (q) => Object.keys(q);
const blanksFor = (q) => Object.fromEntries(Object.keys(q).map(s => [s, 5]));

(async () => {
  const { data: job } = await sb.from('jobs').select('company_id, costing_data, type_meta').eq('id', JOB).single();
  const { data: decs } = await sb.from('decorators').select('id, short_code');
  const decByShort = {}; for (const d of decs || []) if (d.short_code && !decByShort[d.short_code]) decByShort[d.short_code] = d;

  console.log(APPLY ? 'APPLYING:' : 'DRY RUN (add --apply):');
  for (const n of NEW) {
    const units = Object.values(n.qtys).reduce((a, v) => a + v, 0);
    console.log(`  + ${n.name.padEnd(16)} ${n.short.padEnd(7)} ${units}u ship_through in_production`);
  }
  if (!APPLY) return;

  const costProds = [...(job.costing_data?.costProds || [])];
  const vendors = new Set(job.type_meta?.po_sent_vendors || []);
  for (const n of NEW) {
    const dec = decByShort[n.short];
    const { data: item, error } = await sb.from('items').insert({
      job_id: JOB, company_id: job.company_id, name: n.name, garment_type: 'tee',
      blank_vendor: 'S&S', blank_costs: blanksFor(n.qtys), sell_per_unit: n.sell,
      pipeline_stage: 'in_production', shipping_route: 'ship_through',
      artwork_status: 'approved', ship_final: false,
    }).select('id').single();
    if (error) throw new Error('item: ' + error.message);
    const lines = sizesOf(n.qtys).map(s => ({ item_id: item.id, size: s, qty_ordered: n.qtys[s] }));
    await sb.from('buy_sheet_lines').insert(lines);
    if (dec) await sb.from('decorator_assignments').insert({ item_id: item.id, decorator_id: dec.id, pipeline_stage: 'in_production' });
    costProds.push({ id: item.id, name: n.name, printVendor: n.short, sizes: sizesOf(n.qtys), qtys: n.qtys, blankCosts: blanksFor(n.qtys), garment_type: 'tee', _sellOverride: true, _sellOverrideVal: n.sell });
    vendors.add(n.short);
    console.log(`  ✓ ${n.name} (${item.id})`);
  }
  await sb.from('jobs').update({
    costing_data: { ...(job.costing_data || {}), costProds },
    type_meta: { ...(job.type_meta || {}), po_sent_vendors: Array.from(vendors) },
    phase: 'production',
  }).eq('id', JOB);
  console.log(`\n✅ Added ${NEW.length} in-production items · vendors ${Array.from(vendors).join(', ')} · job → production`);
})();
