#!/usr/bin/env node
// One-off: stamp a QB invoice number onto an existing job's type_meta.
// Usage: node scripts/set-qb-invoice-number.js <job_number> <qb_invoice_number>
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const [, , jobNumber, qbInvoiceNumber] = process.argv;
if (!jobNumber || !qbInvoiceNumber) {
  console.error("Usage: node scripts/set-qb-invoice-number.js <job_number> <qb_invoice_number>");
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: jobs, error: readErr } = await supabase
    .from("jobs")
    .select("id, job_number, title, type_meta, clients(name)")
    .eq("job_number", jobNumber);
  if (readErr) { console.error("Read failed:", readErr.message); process.exit(1); }
  if (!jobs || jobs.length === 0) { console.error(`No job with job_number ${jobNumber}`); process.exit(1); }
  if (jobs.length > 1) { console.error(`Found ${jobs.length} jobs with job_number ${jobNumber} — aborting`); process.exit(1); }

  const job = jobs[0];
  const before = job.type_meta?.qb_invoice_number || null;
  console.log("Job:", job.job_number, "·", job.clients?.name || "(no client)", "·", job.title);
  console.log("Current qb_invoice_number:", before);
  console.log("Setting to:", qbInvoiceNumber);

  const newMeta = { ...(job.type_meta || {}), qb_invoice_number: qbInvoiceNumber };
  const { error: writeErr } = await supabase
    .from("jobs")
    .update({ type_meta: newMeta })
    .eq("id", job.id);
  if (writeErr) { console.error("Write failed:", writeErr.message); process.exit(1); }

  const { data: verify } = await supabase
    .from("jobs")
    .select("type_meta")
    .eq("id", job.id)
    .single();
  console.log("Verified qb_invoice_number:", verify?.type_meta?.qb_invoice_number);
})();
