// QB API history import — thin CLI wrapper around lib/qb-history-sync
// (the shared sync the nightly cron runs; extracted Jul 31 2026 so the
// archive stays current without this laptop). The one-time CSV-era --swap
// step is done and gone; see git history for the original standalone body.
// Usage: npx tsx scripts/import-history-qb.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { runQbHistorySync } from "../lib/qb-history-sync";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const r = await runQbHistorySync(db);
  console.log(`\u2713 qb_api sync: ${r.lines} lines \u00b7 $${r.gross.toLocaleString()} \u00b7 ${r.stamped} stamped \u00b7 ${r.assignments} hand assignments`);
})().catch(e => { console.error("QB SYNC FAIL:", e.message); process.exit(1); });
