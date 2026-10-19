// One-off (Oct 16 2026): QuickBooks customer 523 (Concordia Defense) had its
// address fields scrambled by a QB-side edit at 12:08 PT (street in City, ZIP in
// Country). Re-send OpsHub's correct billing + ship-to through the normal sync.
import { createClient } from "@supabase/supabase-js";
import { applyQbSync } from "../lib/qb-customer-sync";
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
(async () => {
  const r = await applyQbSync(db as any, "202f56d9-f7a7-417c-8c3e-6654082839d8", { fields: ["BillAddr", "ShipAddr"], source: "manual" });
  console.log(JSON.stringify(r, null, 1));
})();
