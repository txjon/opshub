#!/usr/bin/env node
/**
 * Show why a job appears in the Order Blanks section of the Command
 * Center. Pass invoice numbers (qb_invoice_number).
 *
 * Usage: node scripts/diag-blanks-alert.js 4145 4172 4191
 */
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const invNums = process.argv.slice(2);
if (invNums.length === 0) { console.error("Usage: node scripts/diag-blanks-alert.js <invNum> [<invNum>...]"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  for (const inv of invNums) {
    const { data: jobs } = await supabase
      .from("jobs")
      .select("id, title, job_number, type_meta, items(id, name, garment_type, blanks_order_number, blanks_order_cost)")
      .filter("type_meta->>qb_invoice_number", "eq", inv);
    const job = jobs?.[0];
    if (!job) { console.log(`#${inv} — not found\n`); continue; }
    console.log(`─── #${inv} · ${job.job_number} · ${job.title} ───`);
    for (const it of (job.items || [])) {
      const cost = it.blanks_order_cost;
      const num = it.blanks_order_number;
      const apparel = it.garment_type !== "accessory"; // current dashboard filter
      console.log(
        `  ${apparel ? "[apparel]" : "[other]  "} ` +
        `${(it.garment_type || "—").padEnd(14)} ` +
        `cost=${cost === null ? "null" : `$${Number(cost).toFixed(2)}`.padEnd(10)} ` +
        `num=${num || "—"} ` +
        `· ${it.name}`
      );
    }
    console.log("");
  }
})().catch(e => { console.error(e); process.exit(1); });
