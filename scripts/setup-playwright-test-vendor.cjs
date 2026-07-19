/* Set up a safe TEST vendor for the Playwright test job so PO/RFQ emails go to
 * jon@housepartydistro.com instead of real decorators. Clones a real decorator's
 * pricing (so the PO PDF still renders), points the contact at jon@, and reassigns
 * every test-job item to it. Idempotent.
 *
 * Run: node scripts/setup-playwright-test-vendor.cjs
 */
require('dotenv').config({ path: '/Users/jonburrow/opshub/.env.local' });
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TEST_EMAIL = 'jon@housepartydistro.com';
const SHORT = 'PWTEST';

(async () => {
  const { data: job } = await sb.from('jobs').select('id, job_number, company_id, costing_data').eq('title', 'TEST — V2 Job Detail').single();
  if (!job) { console.log('Test job not found — run scripts/seed-v2-test-job.cjs first.'); return; }

  // Clone a real, fully-priced decorator (Icon) for the pricing structure.
  const { data: src } = await sb.from('decorators').select('*').eq('short_code', 'ICON').limit(1).single();

  // Find-or-create the test vendor.
  let { data: vendor } = await sb.from('decorators').select('id').eq('short_code', SHORT).maybeSingle();
  if (!vendor) {
    const row = {
      name: 'Playwright Test Vendor',
      short_code: SHORT,
      company_id: job.company_id || src.company_id,
      capabilities: src.capabilities,
      location: src.location,
      lead_time_days: src.lead_time_days,
      notes: 'TEST vendor — PO/RFQ route to jon@ for end-to-end testing. Not a real decorator.',
      contact_name: 'Jon (test vendor)',
      contact_email: TEST_EMAIL,
      contact_phone: '',
      phone: '', address: src.address, city: src.city, state: src.state, zip: src.zip,
      ship_from_address: src.ship_from_address, ship_from_city: src.ship_from_city, ship_from_state: src.ship_from_state, ship_from_zip: src.ship_from_zip,
      pricing_data: src.pricing_data,
      contacts_list: [{ name: 'Jon (test vendor)', role: 'Production', email: TEST_EMAIL, phone: '' }],
      default_shipping_route: src.default_shipping_route,
      transit_days: src.transit_days,
      transit_defaults: src.transit_defaults,
      external_token: crypto.randomUUID(),
    };
    const { data: created, error } = await sb.from('decorators').insert(row).select('id').single();
    if (error) throw new Error('create vendor: ' + error.message);
    vendor = created;
    console.log(`Created "Playwright Test Vendor" (${SHORT}) → ${TEST_EMAIL}`);
  } else {
    // Keep the contact pointed at jon@ in case it drifted.
    await sb.from('decorators').update({ contact_email: TEST_EMAIL, contacts_list: [{ name: 'Jon (test vendor)', role: 'Production', email: TEST_EMAIL, phone: '' }] }).eq('id', vendor.id);
    console.log(`Reusing existing "${SHORT}" (${vendor.id})`);
  }

  // Reassign every test-job item to the test vendor.
  const { data: items } = await sb.from('items').select('id').eq('job_id', job.id);
  const ids = (items || []).map(i => i.id);
  if (ids.length) {
    const { error: aErr } = await sb.from('decorator_assignments').update({ decorator_id: vendor.id }).in('item_id', ids);
    if (aErr) throw new Error('reassign: ' + aErr.message);
  }

  // Point the costing products at the test vendor so PO/Costing pricing lookups
  // resolve to it (sell_per_unit is overridden per item, so quote totals are unchanged).
  const cd = job.costing_data || {};
  if (Array.isArray(cd.costProds)) {
    cd.costProds = cd.costProds.map(cp => ({ ...cp, printVendor: SHORT }));
    await sb.from('jobs').update({ costing_data: cd }).eq('id', job.id);
  }

  console.log(`✅ ${job.job_number}: ${ids.length} items reassigned to ${SHORT}. PO & RFQ now default to ${TEST_EMAIL}.`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
