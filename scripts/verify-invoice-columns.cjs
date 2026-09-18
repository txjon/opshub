#!/usr/bin/env node
// Read-only parity harness for the Invoice Identity Migration (mig 182/183).
// Phase 1-3 gate: every job's columns equal its blob keys (0 deltas).
// Phase 4 gate (--post): no job carries the keys in the blob any more.
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local", quiet: true });
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const post = process.argv.includes("--post");
(async () => {
  let all = [], from = 0;
  while (true) { const { data, error } = await sb.from("jobs").select("id, job_number, qb_invoice_number, qb_invoice_id, type_meta").range(from, from + 999); if (error) { console.error(error.message); process.exit(1); } all = all.concat(data || []); if (!data || data.length < 1000) break; from += 1000; }
  const norm = (v) => (v === undefined || v === null || v === "") ? null : String(v);
  let deltas = [], blobKeyed = 0, withNum = 0, withId = 0;
  for (const j of all) {
    const tm = j.type_meta || {};
    if (tm.qb_invoice_number !== undefined || tm.qb_invoice_id !== undefined) blobKeyed++;
    if (j.qb_invoice_number) withNum++; if (j.qb_invoice_id) withId++;
    if (!post) {
      if (norm(tm.qb_invoice_number) !== norm(j.qb_invoice_number)) deltas.push(`${j.job_number} number blob=${JSON.stringify(tm.qb_invoice_number)} col=${JSON.stringify(j.qb_invoice_number)}`);
      if (norm(tm.qb_invoice_id) !== norm(j.qb_invoice_id)) deltas.push(`${j.job_number} id blob=${JSON.stringify(tm.qb_invoice_id)} col=${JSON.stringify(j.qb_invoice_id)}`);
    }
  }
  console.log(`jobs ${all.length} · column number ${withNum} · column id ${withId} · blob still carries keys on ${blobKeyed}`);
  if (post) { console.log(blobKeyed === 0 ? "POST-STRIP OK: no blob keys remain" : "POST-STRIP FAIL"); process.exit(blobKeyed === 0 ? 0 : 1); }
  console.log(deltas.length ? `PARITY FAIL: ${deltas.length} deltas\n` + deltas.join("\n") : "PARITY OK: 0 deltas");
  process.exit(deltas.length ? 1 : 0);
})();
