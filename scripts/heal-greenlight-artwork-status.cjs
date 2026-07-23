/* HEAL: undo the greenlight false-approval (Jon, Jul 22).
 *
 * Greenlight used to stamp items artwork_status:"approved" — which the proof gate
 * read as "the client signed off on a proof." That's wrong: a greenlight is
 * "looks good, make it," not proof approval. products-server.ts now lands greenlit
 * items "not_started"; this heals the ones already carrying the bad stamp.
 *
 * CONSERVATIVE by design — only resets an item when ALL are true:
 *   - artwork_status = "approved"
 *   - product_id IS NOT NULL           (born from the studio greenlight fork)
 *   - job.quote_approved = false       (never went through package approval)
 *   - job.phase IN (intake, pending)   (still early — not worked into production)
 *   - NO approved proof file exists     (no real client sign-off to preserve)
 * So it can't touch a manual internal approval on a worked job, or any item whose
 * proof the client actually approved.
 *
 *   Dry run (prints the list, no writes):  node scripts/heal-greenlight-artwork-status.cjs
 *   Apply:                                 node scripts/heal-greenlight-artwork-status.cjs --apply
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

(async () => {
  // 1. Every greenlight-origin item still stamped "approved".
  const { data: rows, error } = await sb.from('items')
    .select('id, name, product_id, artwork_status, job_id, jobs(job_number, phase, quote_approved, clients(name))')
    .eq('artwork_status', 'approved')
    .not('product_id', 'is', null);
  if (error) { console.error('query failed:', error.message); process.exit(1); }

  // 2. Keep only early, unapproved-quote jobs.
  const early = (rows || []).filter(r => {
    const j = r.jobs || {};
    return j.quote_approved === false && ['intake', 'pending'].includes(j.phase);
  });

  // 3. Drop any item that has a REAL approved proof (nothing to heal there).
  const ids = early.map(r => r.id);
  let approvedProof = new Set();
  if (ids.length) {
    const { data: pf } = await sb.from('item_files')
      .select('item_id').in('item_id', ids).eq('stage', 'proof').eq('approval', 'approved');
    approvedProof = new Set((pf || []).map(p => p.item_id));
  }
  const targets = early.filter(r => !approvedProof.has(r.id));

  console.log(`\nHEAL — greenlight false-approval (${APPLY ? 'APPLY' : 'DRY RUN'})`);
  console.log(`Scanned ${rows?.length || 0} greenlight-origin "approved" items → ${targets.length} to reset "approved" → "not_started"\n`);
  if (!targets.length) { console.log('Nothing to heal. Done.\n'); return; }

  for (const r of targets) {
    const j = r.jobs || {};
    console.log(`  ${(j.job_number || '—').padEnd(14)} ${(j.clients?.name || '—').slice(0, 22).padEnd(24)} ${r.name} [${j.phase}]`);
  }

  if (!APPLY) { console.log(`\nDry run only. Re-run with --apply to reset these ${targets.length} items.\n`); return; }

  const { error: upErr } = await sb.from('items')
    .update({ artwork_status: 'not_started' }).in('id', targets.map(r => r.id));
  if (upErr) { console.error('\nupdate failed:', upErr.message); process.exit(1); }
  console.log(`\n✓ Reset ${targets.length} items to "not_started". Their jobs will recompute the proof gate on next load.\n`);
})();
