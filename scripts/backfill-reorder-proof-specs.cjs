/* Backfill proof_spec onto reorder-cart items created BEFORE the carry fix
 * (commit 71186747 — copyItemIntoJob now copies proof_spec; this repairs jobs
 * minted before it). Finds cart-sourced jobs (type_meta.source = *_cart),
 * maps each spec-less item back to its source via type_meta.reorder_item_ids
 * (matched by name, then design_id), and copies the source's proof_spec.
 *
 *   node scripts/backfill-reorder-proof-specs.cjs --dry   # preview, no writes
 *   node scripts/backfill-reorder-proof-specs.cjs         # apply
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const DRY = process.argv.includes('--dry');

(async () => {
  const { data: jobs, error } = await sb
    .from('jobs')
    .select('id, job_number, title, type_meta, clients(name)')
    .in('type_meta->>source', ['client_portal_cart', 'internal_cart']);
  if (error) throw error;

  for (const job of jobs || []) {
    const srcIds = job.type_meta?.reorder_item_ids || [];
    if (!srcIds.length) continue;

    const { data: newItems } = await sb.from('items')
      .select('id, name, design_id, proof_spec').eq('job_id', job.id);
    const missing = (newItems || []).filter(it => !it.proof_spec);
    if (!missing.length) continue;

    const { data: srcItems } = await sb.from('items')
      .select('id, name, design_id, proof_spec').in('id', srcIds);

    console.log(`\n${job.job_number || job.id} — ${job.clients?.name} — "${job.title}"`);
    for (const it of missing) {
      const src = (srcItems || []).find(s => s.name === it.name && s.proof_spec)
        || (srcItems || []).find(s => s.design_id && s.design_id === it.design_id && s.proof_spec);
      if (!src) { console.log(`  · ${it.name}: no source proof_spec found — skipped`); continue; }
      if (DRY) { console.log(`  · ${it.name}: would copy proof_spec from source ${src.id}`); continue; }
      const { error: upErr } = await sb.from('items')
        .update({ proof_spec: src.proof_spec }).eq('id', it.id);
      console.log(`  · ${it.name}: ${upErr ? 'FAILED — ' + upErr.message : 'proof_spec copied from ' + src.id}`);
    }
  }
  console.log(DRY ? '\nDry run — nothing written.' : '\nDone.');
})();
