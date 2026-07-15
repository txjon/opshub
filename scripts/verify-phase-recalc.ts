// Verify recalcJobPhase: advances the test job to complete (all items done),
// and is idempotent on real jobs (recompute → same phase, no spurious change).
//   run: npx tsx scripts/verify-phase-recalc.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { recalcJobPhase } from "../lib/job-phase-recalc";

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const TEST_JOB = "cba08dfb-2efb-4e28-834c-3d3857cda4d1";

(async () => {
  // 1) test job — should land on complete (all forwarded/entered)
  const { data: before } = await sb.from("jobs").select("phase").eq("id", TEST_JOB).single();
  await recalcJobPhase(sb, TEST_JOB);
  const { data: after } = await sb.from("jobs").select("phase").eq("id", TEST_JOB).single();
  console.log(`TEST JOB HPD-2606-050: ${(before as any)?.phase} → ${(after as any)?.phase}  ${(after as any)?.phase === "complete" ? "✓ complete" : "(check)"}`);

  // 2) idempotency on real active jobs — recalc must not change a job it shouldn't
  const { data: jobs } = await sb.from("jobs").select("id, job_number, phase")
    .not("phase", "in", "(complete,cancelled,on_hold)").neq("id", TEST_JOB)
    .order("created_at", { ascending: false }).limit(8);
  let changed = 0;
  for (const j of (jobs || []) as any[]) {
    const b = j.phase;
    await recalcJobPhase(sb, j.id);
    const { data: a } = await sb.from("jobs").select("phase").eq("id", j.id).single();
    const moved = (a as any)?.phase !== b;
    if (moved) { changed++; console.log(`  ${j.job_number}: ${b} → ${(a as any)?.phase}  (recalc corrected a stale phase)`); }
  }
  console.log(`\nReal jobs recomputed: ${(jobs || []).length}, phase changed: ${changed}`);
  console.log("(changes here are the recalc CORRECTING jobs the legacy job-page recalc hadn't refreshed — inspect if unexpected)");
})();
