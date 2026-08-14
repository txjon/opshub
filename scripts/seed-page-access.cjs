/* Seed profiles.page_access from opshub-access-map.csv.
 * Run AFTER migration 108 (the page_access column must exist).
 *
 *   node scripts/seed-page-access.cjs --dry   # preview, no writes
 *   node scripts/seed-page-access.cjs         # apply
 *
 * Maps each CSV user column (first name) -> profile by full_name, and sets
 * page_access = the routes marked "X" for that column. Skips retired/not-yet
 * pages (/warehouse, /templates, /billing). Adrien (IHM, phasing out) + the
 * test account have no X's -> left NULL (legacy role fallback).
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DRY = process.argv.includes('--dry');

// Routes that exist in lib/access PAGE_CATALOG today (the grantable set).
// /warehouse + /templates are retired; /billing arrives in Phase 1.5.
const CATALOG = new Set([
  '/god-mode','/reports','/reconciliation','/integrations',
  '/dashboard','/jobs','/studio','/production',
  '/distro','/receiving','/shipping','/fulfillment','/hours',
  '/ecomm','/intake','/clients','/decorators','/settings/designers',
  '/settings','/billing','/toolkit','/references',
]);

function parseCsv(text) {
  // minimal CSV: handles quoted fields with commas
  return text.trim().split('\n').map(line => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  });
}

(async () => {
  const rows = parseCsv(fs.readFileSync('opshub-access-map.csv', 'utf8'));
  const header = rows[0];
  // user columns start after "Sensitive" (index 4) -> indices 5..n
  const firstUserCol = 5;
  const userCols = header.slice(firstUserCol).map((name, i) => ({ name: name.trim(), idx: firstUserCol + i }));

  // accumulate routes per user
  const grants = {}; userCols.forEach(u => grants[u.name] = []);
  for (const row of rows.slice(1)) {
    const route = (row[2] || '').trim();
    if (!CATALOG.has(route)) continue; // skip retired / not-yet / blank-route rows
    for (const u of userCols) {
      if ((row[u.idx] || '').trim().toUpperCase() === 'X') grants[u.name].push(route);
    }
  }

  const { data: profiles } = await sb.from('profiles').select('id, full_name');
  console.log('=== page_access seed ===');
  for (const u of userCols) {
    const list = grants[u.name];
    if (!list.length) { console.log(`- ${u.name}: (no grants in CSV) -> leaving NULL (role fallback)`); continue; }
    const prof = (profiles || []).find(p => p.full_name === u.name || (p.full_name || '').startsWith(u.name + ' '));
    if (!prof) { console.log(`- ${u.name}: ⚠ no matching profile (full_name), SKIPPED`); continue; }
    console.log(`- ${u.name} -> ${prof.full_name}: ${list.length} pages [${list.join(', ')}]`);
    if (!DRY) {
      const { error } = await sb.from('profiles').update({ page_access: list }).eq('id', prof.id);
      if (error) console.log(`    ✗ ${error.message}`);
    }
  }
  console.log(DRY ? '\n(dry run — no writes)' : '\n✅ applied');
})();
