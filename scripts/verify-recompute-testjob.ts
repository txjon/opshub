// Run recomputeItemFromLedger on the test job's items and inspect the resulting
// legacy fields vs the ledger-derived done-state. Confirms the bridge SETS
// correctly and doesn't crash on the new shipment_lines lookup.
//   run: npx tsx scripts/verify-recompute-testjob.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { recomputeItemFromLedger } from "../lib/inventory-ledger";

const TEST_JOB = "cba08dfb-2efb-4e28-834c-3d3857cda4d1"; // HPD-2606-050
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const sumQ = (q: any) => Object.values(q || {}).reduce((a: number, n: any) => a + (Number(n) || 0), 0);

(async () => {
  const { data: items } = await sb.from("items")
    .select("id, name, shipping_route, jobs(shipping_route)")
    .eq("job_id", TEST_JOB).order("sort_order");
  if (!items?.length) { console.log("no items on test job"); return; }

  for (const it of items as any[]) {
    const route = it.shipping_route || it.jobs?.shipping_route || "ship_through";
    const st = await recomputeItemFromLedger(sb, it.id);
    const { data: after } = await sb.from("items")
      .select("received_at_hpd, received_qtys, ship_qtys, forwarded_at, forward_tracking, webstore_entered_at")
      .eq("id", it.id).single();
    const a = after as any;
    console.log(`\n${it.name.slice(0, 30).padEnd(30)} [${route}]`);
    console.log(`  ledger: shipped=${st?.shipped} received=${st?.received} forwarded=${st?.forwarded} staged=${st?.staged} onHand=${st?.onHand}`);
    console.log(`  legacy: recd_at_hpd=${a.received_at_hpd}  recd_qtys=${sumQ(a.received_qtys)}  ship_qtys=${sumQ(a.ship_qtys)}  fwd_at=${a.forwarded_at ? "SET" : "—"}  fwd_trk=${a.forward_tracking || "—"}  entered_at=${a.webstore_entered_at ? "SET" : "—"}`);
  }
  console.log("\n✓ recompute ran on all test-job items without error.");
})();
