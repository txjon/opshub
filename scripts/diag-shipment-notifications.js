#!/usr/bin/env node
/**
 * Print the shipping_notifications array OpsHub recorded for a given
 * job — confirms exactly which recipients were on each shipment email.
 *
 * Usage:
 *   node scripts/diag-shipment-notifications.js INV-1234
 *   node scripts/diag-shipment-notifications.js HPD-2604-046
 *
 * Looks up by qb_invoice_number first, falls back to job_number.
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: node scripts/diag-shipment-notifications.js <invoice# or job#>");
  process.exit(1);
}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  // Try by job_number first
  let { data: jobs } = await sb
    .from("jobs")
    .select("id, title, job_number, type_meta, shipping_route, clients(name)")
    .eq("job_number", arg);

  if (!jobs || jobs.length === 0) {
    // Fall back: search type_meta.qb_invoice_number
    const { data: all } = await sb
      .from("jobs")
      .select("id, title, job_number, type_meta, shipping_route, clients(name)");
    jobs = (all || []).filter(j => (j.type_meta || {}).qb_invoice_number === arg);
  }

  if (!jobs || jobs.length === 0) {
    console.error(`No job found matching "${arg}".`);
    process.exit(2);
  }

  for (const job of jobs) {
    const tm = job.type_meta || {};
    const records = Array.isArray(tm.shipping_notifications) ? tm.shipping_notifications : [];
    console.log("=".repeat(70));
    console.log(`Job: ${job.job_number}  (Invoice: ${tm.qb_invoice_number || "—"})`);
    console.log(`Title: ${job.title}`);
    console.log(`Client: ${(job.clients || {}).name || "—"}`);
    console.log(`Route: ${job.shipping_route || "—"}`);
    console.log(`Notifications recorded: ${records.length}`);
    console.log("");
    if (records.length === 0) {
      console.log("  (none)");
    } else {
      records.forEach((r, i) => {
        const when = new Date(r.sentAt).toLocaleString();
        console.log(`  [${i + 1}] ${r.type}  · ${when}${r.resend ? "  · RESEND" : ""}`);
        console.log(`       Decorator : ${r.decoratorName || "—"} (${r.decoratorId || "no id"})`);
        console.log(`       Tracking  : ${r.tracking || "—"}`);
        console.log(`       Recipients: ${(r.recipients || []).join(", ") || "—"}`);
        console.log("");
      });
    }
  }
})();
