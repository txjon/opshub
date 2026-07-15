// Backfill the movement ledger (migration 119) from legacy item data.
//
// For every item that ever shipped, seed one immutable `ship` movement (and
// receive/forward/stage movements where those handoffs happened), then sync the
// item's ship_qtys/received_qtys cache to match. Idempotent: skips any item that
// already has movements.
//
//   node scripts/backfill-movements.cjs --dry     # preview, writes nothing
//   node scripts/backfill-movements.cjs           # apply
//
// Sources (stamped on each row so the audit trail distinguishes them):
//   legacy   — real per-size qtys entered in the old flow (kept exactly)
//   backfill — never captured; shipped=ordered ("unedited = no variance"), and
//              received=shipped for items that were demonstrably received/done.

const fs = require('fs');
const path = require('path');

let KEY, URL;
for (const line of fs.readFileSync(path.join(__dirname, '..', '.env.local'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_0-9]+)=(.*)$/); if (!m) continue;
  if (m[1] === 'SUPABASE_SERVICE_ROLE_KEY') KEY = m[2].replace(/^"|"$/g, '');
  if (m[1] === 'NEXT_PUBLIC_SUPABASE_URL') URL = m[2].replace(/^"|"$/g, '');
}
const { createClient } = require(path.join(__dirname, '..', 'node_modules', '@supabase/supabase-js'));
const sb = createClient(URL, KEY);

const DRY = process.argv.includes('--dry');
const sum = o => Object.values(o || {}).reduce((s, n) => s + (Number(n) || 0), 0);
const nonEmpty = o => o && Object.keys(o).length > 0;
const DONE_PHASES = new Set(['complete', 'cancelled', 'fulfillment']);

(async () => {
  // Every item with any shipping activity.
  const { data: items, error } = await sb.from('items')
    .select('id, company_id, name, job_id, pipeline_stage, pipeline_timestamps, ship_qtys, received_qtys, received_at_hpd, received_at_hpd_at, forwarded_at, forward_tracking, webstore_entered_at, webstore_entered_by, ship_tracking, shipping_route, created_at, buy_sheet_lines(size, qty_ordered), jobs(shipping_route, phase)')
    .or('pipeline_stage.eq.shipped,ship_qtys.not.is.null,received_qtys.not.is.null,forwarded_at.not.is.null,webstore_entered_at.not.is.null');
  if (error) { console.error('fetch items', error); process.exit(1); }

  // Which items already have movements (idempotency).
  const { data: existing } = await sb.from('movements').select('item_id');
  const haveMovements = new Set((existing || []).map(m => m.item_id));

  const stats = { items: 0, skipped: 0, ship: 0, receive: 0, forward: 0, stage: 0, shipLegacy: 0, shipBackfill: 0 };
  const rows = [];
  const cacheUpdates = [];

  for (const it of items || []) {
    if (haveMovements.has(it.id)) { stats.skipped++; continue; }
    const ordered = Object.fromEntries((it.buy_sheet_lines || []).map(l => [l.size, Number(l.qty_ordered) || 0]));
    const route = it.shipping_route || it.jobs?.shipping_route || 'ship_through';
    const phase = it.jobs?.phase;
    const ts = it.pipeline_timestamps || {};

    // ── SHIP ──
    // A pipeline_stage='shipped' item shipped its FULL order by default (Jon's
    // rule: unedited = no variance). Legacy ship_qtys that UNDER-count ordered
    // are the old overwrite bug (ship_qtys held only the last of N batches) —
    // not a real short — so fill each size up to ordered. Genuine per-size
    // OVER-ships are kept (positive variance, Jon's decision). An in_production
    // item's ship_qtys is a real partial wave — kept as-is.
    let shipped = null, shipSource = null;
    if (it.pipeline_stage === 'shipped') {
      // Legacy baseline: a fully-shipped item shipped its ordered qty, no variance
      // (Jon's rule — the old flow never reliably recorded real ship qtys, and its
      // ship_qtys was overwritten to the last batch). Deterministic: ignores the
      // unreliable ship_qtys entirely. Going-forward ships record exact over/under.
      shipped = ordered; shipSource = 'backfill';
    } else if (sum(it.ship_qtys) > 0) {
      // in_production partial wave — a genuine, still-open shipped-so-far count.
      shipped = it.ship_qtys; shipSource = 'legacy';
    }
    if (!nonEmpty(shipped)) { stats.skipped++; continue; }   // in_production, nothing shipped yet — no ledger needed

    stats.items++;
    const shipAt = ts.shipped || it.created_at || new Date().toISOString();
    rows.push({
      company_id: it.company_id, item_id: it.id, job_id: it.job_id, description: it.name,
      type: 'ship', qtys: shipped, tracking: (it.ship_tracking || null),
      source: shipSource, reason: shipSource === 'backfill' ? 'Pre-ledger backfill (shipped = ordered, no recorded variance)' : 'Pre-ledger (recorded shipped qtys)',
      created_at: shipAt,
    });
    stats.ship++; shipSource === 'legacy' ? stats.shipLegacy++ : stats.shipBackfill++;

    // ── RECEIVE ── (never for drop_ship — those never touch HPD)
    let received = null;
    if (route !== 'drop_ship') {
      if (sum(it.received_qtys) > 0) { received = it.received_qtys; }
      else if (it.received_at_hpd || it.forwarded_at || it.webstore_entered_at || DONE_PHASES.has(phase)) { received = shipped; }
    }
    if (nonEmpty(received)) {
      rows.push({
        company_id: it.company_id, item_id: it.id, job_id: it.job_id, description: it.name,
        type: 'receive', qtys: received,
        source: sum(it.received_qtys) > 0 ? 'legacy' : 'backfill',
        reason: sum(it.received_qtys) > 0 ? 'Pre-ledger (recorded received qtys)' : 'Pre-ledger backfill (received = shipped)',
        created_at: it.received_at_hpd_at || shipAt,
      });
      stats.receive++;
    }

    // ── FORWARD (ship_through) ──
    if (it.forwarded_at) {
      const fwd = nonEmpty(received) ? received : shipped;
      rows.push({
        company_id: it.company_id, item_id: it.id, job_id: it.job_id, description: it.name,
        type: 'forward', qtys: fwd, tracking: it.forward_tracking || null,
        source: 'backfill', reason: 'Pre-ledger backfill (forwarded to client)', created_at: it.forwarded_at,
      });
      stats.forward++;
    }

    // ── STAGE (webstore) ──
    if (it.webstore_entered_at) {
      const stg = nonEmpty(received) ? received : shipped;
      rows.push({
        company_id: it.company_id, item_id: it.id, job_id: it.job_id, description: it.name,
        type: 'stage', qtys: stg,
        source: 'backfill', reason: 'Pre-ledger backfill (staged to webstore)', created_at: it.webstore_entered_at,
      });
      stats.stage++;
    }

    // ── item cache sync (ship_qtys/received_qtys/received_at_hpd) ──
    const recvTotal = sum(received), shipTotal = sum(shipped);
    cacheUpdates.push({
      id: it.id,
      ship_qtys: shipped,
      received_qtys: nonEmpty(received) ? received : null,
      received_at_hpd: route !== 'drop_ship' && shipTotal > 0 && recvTotal >= shipTotal,
    });
  }

  console.log('BACKFILL', DRY ? '(dry run)' : '(APPLYING)');
  console.log(JSON.stringify(stats, null, 2));
  console.log(`movement rows to insert: ${rows.length}; item caches to sync: ${cacheUpdates.length}`);

  if (DRY) { console.log('\n(dry run — nothing written)'); return; }

  // Insert movements in chunks.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error: e } = await sb.from('movements').insert(chunk);
    if (e) { console.error('insert movements chunk', i, e); process.exit(1); }
  }
  // Sync item caches.
  let synced = 0;
  for (const u of cacheUpdates) {
    const { error: e } = await sb.from('items').update({
      ship_qtys: u.ship_qtys, received_qtys: u.received_qtys, received_at_hpd: u.received_at_hpd,
    }).eq('id', u.id);
    if (e) { console.error('sync item', u.id, e); process.exit(1); }
    synced++;
  }
  console.log(`\nDONE — inserted ${rows.length} movements, synced ${synced} item caches.`);
})();
