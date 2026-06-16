// TEMP: curated lookup of a job by job_number for debugging. Safe to delete.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const arg = process.argv[2] || "HPD-2605-055";
const j = (v) => JSON.stringify(v);

(async () => {
  const { data: job, error } = await sb
    .from("jobs")
    .select("*, clients(name, default_terms, company_id), items(*), payment_records(*), job_contacts(role_on_job, contacts(name, email))")
    .eq("job_number", arg)
    .maybeSingle();
  if (error) { console.error(error); process.exit(1); }
  if (!job) { console.log("No job found for", arg); process.exit(0); }

  const { data: companies } = await sb.from("companies").select("id, slug");
  const slug = (companies || []).find(c => c.id === job.company_id)?.slug || job.company_id || "—";

  console.log("=== JOB ===");
  console.log(`job_number:     ${job.job_number}`);
  console.log(`id:             ${job.id}`);
  console.log(`tenant:         ${slug.toUpperCase()}  (company_id ${job.company_id})`);
  console.log(`title:          ${job.title}`);
  console.log(`client:         ${job.clients?.name || "—"}  (terms: ${job.clients?.default_terms || "—"})`);
  console.log(`job_type:       ${job.job_type}`);
  console.log(`phase:          ${job.phase}   on_hold:${job.on_hold ?? "—"}`);
  console.log(`shipping_route: ${job.shipping_route}`);
  console.log(`quote_approved: ${job.quote_approved}  at ${job.quote_approved_at || "—"}`);
  console.log(`ship_date:      ${job.ship_date || "—"}   in_hands: ${job.in_hands_date || "—"}`);
  console.log(`created_at:     ${job.created_at}`);
  console.log(`blanks_order:   ${job.blanks_order_number || "—"}`);
  console.log(`fulfillment:    status=${job.fulfillment_status || "—"} tracking=${job.fulfillment_tracking || "—"}`);
  console.log(`costing_summary:${j(job.costing_summary)}`);
  console.log(`type_meta:      ${j(job.type_meta)}`);
  console.log(`costing_data:   ${job.costing_data ? `present, ${job.costing_data?.costProds?.length ?? 0} costProds` : "NULL"}`);

  const items = job.items || [];
  console.log(`\n=== ITEMS (${items.length}) ===`);
  for (const it of items) {
    const totalQty = it.qtys ? Object.values(it.qtys).reduce((a, b) => a + (Number(b) || 0), 0) : (it.total_qty ?? "—");
    console.log(`- ${it.name || "(unnamed)"}  [id ${it.id}]`);
    console.log(`    garment_type:${it.garment_type || "—"}  vendor:${it.vendor || it.print_vendor || "—"}  stage:${it.pipeline_stage || "—"}`);
    console.log(`    sell_per_unit:${it.sell_per_unit ?? "—"}  totalQty:${totalQty}  blanks_order#:${it.blank_order_number || it.blanks_order_number || "—"}`);
    console.log(`    drive_link:${it.drive_link || "—"}`);
    console.log(`    received_at_hpd:${it.received_at_hpd ?? "—"}  ship_qtys:${j(it.ship_qtys)}  received_qtys:${j(it.received_qtys)}`);
  }

  const pays = job.payment_records || [];
  console.log(`\n=== PAYMENTS (${pays.length}) ===`);
  for (const p of pays) {
    console.log(`- ${p.payment_type || p.type || "—"}  $${p.amount}  status:${p.status}  inv#:${p.invoice_number || "—"}  due:${p.due_date || "—"}  paid:${p.paid_date || "—"}`);
  }

  const cons = job.job_contacts || [];
  console.log(`\n=== CONTACTS (${cons.length}) ===`);
  for (const c of cons) console.log(`- ${c.role}: ${c.contacts?.name || "—"} <${c.contacts?.email || "—"}>`);
})();
