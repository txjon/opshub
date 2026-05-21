// One-off: revert pipeline_stage on items that were marked in_production
// by a PO send that's since been revoked. Mirrors the inverse logic of
// the (now-fixed) PO un-mark handler.
//
// Usage:
//   node scripts/revert-po-items.js <job-number> <decorator-name>
//   node scripts/revert-po-items.js HPD-2605-032 "Battle Maple"
//
// Dry-runs first by default — lists what would change. Pass --apply
// as the last arg to actually write.

require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const [jobNumber, decoratorRaw] = args.filter(a => a !== "--apply");
if (!jobNumber || !decoratorRaw) {
  console.error('Usage: node scripts/revert-po-items.js <job-number> "<decorator-name>" [--apply]');
  process.exit(1);
}
const decorator = decoratorRaw.toLowerCase().trim();

const supa = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

(async () => {
  const { data: job } = await supa.from("jobs")
    .select("id, job_number, title, type_meta")
    .eq("job_number", jobNumber)
    .single();
  if (!job) { console.error("Job not found:", jobNumber); process.exit(1); }
  console.log(`Job: ${job.job_number} — ${job.title}`);
  console.log(`Target decorator: ${decoratorRaw}`);
  console.log(`po_sent_vendors on job: ${JSON.stringify(job.type_meta?.po_sent_vendors || [])}`);
  console.log("");

  const { data: items } = await supa.from("items")
    .select("id, name, pipeline_stage, pipeline_timestamps, decorator_assignments(decorators(name, short_code))")
    .eq("job_id", job.id);

  const candidates = (items || []).filter(it => {
    const a = it.decorator_assignments?.[0];
    const name = a?.decorators?.name?.toLowerCase()?.trim();
    const code = a?.decorators?.short_code?.toLowerCase()?.trim();
    return (name === decorator || code === decorator) && it.pipeline_stage === "in_production";
  });

  if (candidates.length === 0) {
    console.log("No items match (none currently in_production for this decorator).");
    return;
  }

  console.log(`Items to revert (${candidates.length}):`);
  for (const it of candidates) {
    console.log(`  - ${it.name} (${it.id})  pipeline_stage=${it.pipeline_stage}`);
  }
  console.log("");

  if (!apply) {
    console.log("Dry-run. Re-run with --apply to write changes.");
    return;
  }

  for (const it of candidates) {
    const ts = { ...(it.pipeline_timestamps || {}) };
    delete ts.in_production;
    const { error } = await supa.from("items")
      .update({ pipeline_stage: null, pipeline_timestamps: ts })
      .eq("id", it.id);
    if (error) {
      console.error(`  FAILED ${it.id}:`, error.message);
    } else {
      console.log(`  reverted ${it.id}`);
    }
  }
  console.log("");
  console.log(`Done. ${candidates.length} item${candidates.length === 1 ? "" : "s"} reverted to Setup.`);
})();
