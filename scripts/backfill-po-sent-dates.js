#!/usr/bin/env node
/**
 * Backfill type_meta.po_sent_dates from job_activity log.
 *
 * Bug history: until 2026-04-30 the email-send and manual-toggle
 * paths in POTab.jsx wrote a fresh `new Date()` into
 * type_meta.po_sent_dates[vendor] every time, clobbering the
 * original send date. The PO PDF reads from that field, so older
 * POs were rendering today's date.
 *
 * The "PO sent to {vendor} ({n} items)" activity-log row keeps an
 * immutable created_at timestamp. This script walks job_activity,
 * finds the EARLIEST "PO sent to {vendor}" entry per (job, vendor),
 * and writes that timestamp into type_meta.po_sent_dates[vendor]
 * if either:
 *   - The field is missing entirely, OR
 *   - The activity timestamp is older than the stored value (the
 *     stored value came from a resend that overwrote the original).
 *
 * Manual mark-sent rows ("PO for {vendor} manually marked as sent")
 * are also matched.
 *
 * Usage:
 *   node scripts/backfill-po-sent-dates.js                   # dry run
 *   node scripts/backfill-po-sent-dates.js --apply           # write
 *   node scripts/backfill-po-sent-dates.js --job=HPD-2604-044 --apply
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const jobArg = process.argv.find(a => a.startsWith("--job="));
const jobNumber = jobArg ? jobArg.slice("--job=".length) : null;

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SENT_MSG_RE = /^PO sent to (.+?) \(\d+ items?\)$/i;
const MANUAL_MSG_RE = /^PO for (.+?) manually marked as sent/i;

function parseSentMessage(msg) {
  const a = msg && msg.match(SENT_MSG_RE);
  if (a) return a[1].trim();
  const b = msg && msg.match(MANUAL_MSG_RE);
  if (b) return b[1].trim();
  return null;
}

(async () => {
  const jobsQuery = sb.from("jobs").select("id, job_number, type_meta");
  if (jobNumber) jobsQuery.eq("job_number", jobNumber);
  const { data: jobs, error: jobsErr } = await jobsQuery;
  if (jobsErr) { console.error("jobs query failed:", jobsErr); process.exit(1); }

  console.log(`[backfill-po-sent-dates] ${APPLY ? "APPLY" : "DRY RUN"} — scanning ${jobs.length} job(s)`);

  let totalUpdated = 0;
  let totalNoChange = 0;
  let totalNoActivity = 0;

  for (const job of jobs) {
    const tm = job.type_meta || {};
    const sentVendors = Array.isArray(tm.po_sent_vendors) ? tm.po_sent_vendors : [];
    if (sentVendors.length === 0) continue; // never sent → nothing to backfill

    const { data: activity } = await sb
      .from("job_activity")
      .select("message, created_at")
      .eq("job_id", job.id)
      .order("created_at", { ascending: true });

    const earliestPerVendor = {};
    for (const row of (activity || [])) {
      const vendor = parseSentMessage(row.message);
      if (!vendor) continue;
      if (!earliestPerVendor[vendor] || new Date(row.created_at) < new Date(earliestPerVendor[vendor])) {
        earliestPerVendor[vendor] = row.created_at;
      }
    }

    const existingDates = tm.po_sent_dates || {};
    const updates = {};
    for (const vendor of sentVendors) {
      const earliest = earliestPerVendor[vendor];
      if (!earliest) continue;
      const stored = existingDates[vendor];
      if (!stored || new Date(earliest) < new Date(stored)) {
        updates[vendor] = earliest;
      }
    }

    if (Object.keys(updates).length === 0) {
      if (sentVendors.some(v => !earliestPerVendor[v])) totalNoActivity++;
      else totalNoChange++;
      continue;
    }

    const merged = { ...existingDates, ...updates };
    console.log(`  ${job.job_number}:`);
    for (const [v, ts] of Object.entries(updates)) {
      const before = existingDates[v] ? new Date(existingDates[v]).toLocaleString() : "(none)";
      const after = new Date(ts).toLocaleString();
      console.log(`    ${v}: ${before}  →  ${after}`);
    }

    if (APPLY) {
      const newMeta = { ...tm, po_sent_dates: merged };
      const { error } = await sb.from("jobs").update({ type_meta: newMeta }).eq("id", job.id);
      if (error) { console.error(`    update failed:`, error.message); continue; }
    }
    totalUpdated++;
  }

  console.log(`\n${APPLY ? "Wrote" : "Would write"} ${totalUpdated} job(s). ${totalNoChange} unchanged. ${totalNoActivity} have sent vendors but no matching activity log.`);
  if (!APPLY) console.log("Re-run with --apply to write.");
})();
