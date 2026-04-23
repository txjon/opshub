#!/usr/bin/env node
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const jobNumber = process.argv[2];
if (!jobNumber) { console.error("Usage: node scripts/lookup-job.js <job_number>"); process.exit(1); }

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data, error } = await supabase.from("jobs").select("id, title, job_number, type_meta").eq("job_number", jobNumber).single();
  if (error || !data) { console.error("Not found:", error?.message); process.exit(1); }
  console.log(JSON.stringify({
    id: data.id,
    title: data.title,
    job_number: data.job_number,
    qb_invoice_id: data.type_meta?.qb_invoice_id || null,
    qb_invoice_number: data.type_meta?.qb_invoice_number || null,
    qb_payment_link: data.type_meta?.qb_payment_link || null,
  }, null, 2));
})();
