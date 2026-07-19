/* Reset the V2 test job (HPD-2607-023 "TEST — V2 Job Detail") back to BEFORE the
 * quote is sent — a clean starting point for an end-to-end run: costing is done,
 * proofs exist, but nothing has been sent/approved/invoiced/ordered/produced.
 *
 * Run: node scripts/reset-v2-test-prequote.cjs
 */
require('dotenv').config({ path: '/Users/jonburrow/opshub/.env.local' });
const { createClient } = require('@supabase/supabase-js');
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// type_meta keys that are transactional (quote/invoice/PO/approval) — stripped on reset.
const DROP_META = [
  'quote_sent_at', 'qb_invoice_number', 'qb_invoice_id', 'qb_payment_link', 'qb_tax_amount',
  'qb_total_with_tax', 'qb_invoice_created_at', 'qb_invoice_updated_at', 'qb_variance_pushed_at',
  'qb_variance_total', 'qb_variance_tax', 'qb_variance_billable_qtys', 'invoice_sent_at',
  'invoice_date_override', 'last_reminder_sent_at', 'po_sent_vendors', 'po_sent_dates',
  'po_ship_dates', 'po_ship_methods', 'approval_snapshot', 'change_request', 'costing_locked',
];

(async () => {
  const { data: job } = await sb.from('jobs').select('id, job_number, type_meta').eq('title', 'TEST — V2 Job Detail').single();
  if (!job) { console.log('Test job not found — run scripts/seed-v2-test-job.cjs first.'); return; }

  const tm = { ...(job.type_meta || {}) };
  for (const k of DROP_META) delete tm[k];

  await sb.from('jobs').update({
    phase: 'intake',
    quote_approved: false,
    quote_approved_at: null,
    quote_rejection_notes: null,
    fulfillment_status: null,
    fulfillment_tracking: null,
    type_meta: tm,
  }).eq('id', job.id);

  const { data: items } = await sb.from('items').select('id').eq('job_id', job.id);
  const ids = (items || []).map(i => i.id);

  if (ids.length) {
    // Items → pre-production: no blanks, no shipping, art not approved.
    await sb.from('items').update({
      pipeline_stage: null,
      artwork_status: 'not_started',
      blanks_order_number: null,
      blanks_order_cost: null,
      ship_qtys: null,
      ship_tracking: null,
      received_at_hpd: false,
      received_at_hpd_at: null,
      received_qtys: null,
      forwarded_at: null,
      forward_tracking: null,
      webstore_entered_at: null,
    }).in('id', ids);

    // Buy-sheet lines → ordered only.
    await sb.from('buy_sheet_lines').update({ qty_shipped_from_vendor: null, qty_received_at_hpd: null }).in('item_id', ids);

    // Decorator assignments → not sent.
    await sb.from('decorator_assignments').update({
      pipeline_stage: null, sent_to_decorator_date: null, tracking_number: null,
      actual_completion_date: null, est_completion_date: null,
    }).in('item_id', ids);

    // Proofs → not yet sent for review (client hasn't seen them).
    await sb.from('item_files').update({
      approval: 'none', approved_at: null, notes: null, revision_pending_send: false,
    }).in('item_id', ids).eq('stage', 'proof');
  }

  // No payments yet.
  await sb.from('payment_records').delete().eq('job_id', job.id);

  console.log(`✅ ${job.job_number} reset to PRE-QUOTE: costing intact, quote not sent, proofs pending upload-review, no invoice/PO/payments/production.`);
  console.log(`   Open: /jobs/${job.id}  ·  portal (after you send): /portal/<token>`);
})().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
