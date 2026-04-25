#!/usr/bin/env node
/**
 * Re-classify existing QB-sourced payment_records that were inserted as
 * type=full_payment when they actually only partially covered the
 * invoice. The pre-fix qb webhook hardcoded type/status regardless of
 * amount vs invoice total — this corrects the type so project list +
 * payment summaries read partial state correctly.
 *
 * Rule: amount < qb_total_with_tax (or costing_summary.grossRev) → deposit.
 *
 * Usage:
 *   node scripts/backfill-payment-types.js                # dry run, all jobs
 *   node scripts/backfill-payment-types.js --apply        # write
 *   node scripts/backfill-payment-types.js --job=HPD-2604-008 --apply
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const jobArg = process.argv.find(a => a.startsWith("--job="));
const jobNumber = jobArg ? jobArg.slice("--job=".length) : null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  let jobQ = sb.from("jobs").select("id, job_number, title, type_meta, costing_summary, payment_records(id, type, amount, status, paid_date)");
  if (jobNumber) jobQ = jobQ.eq("job_number", jobNumber);
  const { data: jobs, error } = await jobQ;
  if (error) { console.error(error); process.exit(1); }

  let touched = 0, scanned = 0;
  for (const job of jobs || []) {
    const total = Number(job.type_meta?.qb_total_with_tax)
      || Number(job.costing_summary?.grossRev)
      || 0;
    if (total <= 0.01) continue;
    const records = job.payment_records || [];
    if (records.length === 0) continue;

    // Re-check every collected QB-style payment row. Includes deposit
    // and balance so a previous strict-EPSILON pass that reclassified
    // a $0.46-short payment as deposit gets corrected back to
    // full_payment under the new tolerance.
    const candidates = records.filter(r =>
      ["full_payment", "deposit", "balance"].includes(r.type) &&
      (r.status === "paid" || r.status === "partial")
    );
    if (candidates.length === 0) continue;

    for (const r of candidates) {
      // Sum OTHER paid amounts to determine cumulative without this row.
      // EPSILON ($0.50) absorbs QB processing-fee rounding so an $80
      // payment on an $80.46 invoice reads as full_payment, not deposit.
      const EPSILON = 0.5;
      const otherPaid = records
        .filter(o => o.id !== r.id && (o.status === "paid" || o.status === "partial"))
        .reduce((a, o) => a + (Number(o.amount) || 0), 0);
      const cumulative = otherPaid + Number(r.amount || 0);
      const closesInvoice = cumulative >= total - EPSILON;

      let newType = "full_payment";
      if (!closesInvoice) newType = "deposit";
      else if (otherPaid > EPSILON) newType = "balance";

      scanned++;
      if (newType === r.type) continue;

      touched++;
      console.log(`  ${job.job_number} (${job.title})`);
      console.log(`    record ${r.id.slice(0,8)}  amount=$${Number(r.amount).toLocaleString()}  total=$${total.toLocaleString()}  ${r.type} → ${newType}`);
      if (APPLY) {
        const { error: updErr } = await sb.from("payment_records").update({ type: newType }).eq("id", r.id);
        if (updErr) console.error("    ✖ update failed:", updErr.message);
        else console.log("    ✓ updated");
      }
    }
  }

  console.log(`\nScanned ${scanned} full_payment record(s) across ${jobs?.length || 0} job(s).`);
  console.log(`${APPLY ? "Updated" : "Would update"}: ${touched}`);
  if (!APPLY && touched > 0) console.log("Re-run with --apply to write.");
})();
