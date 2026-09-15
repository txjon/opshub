// Parity harness for the split-shipments foundation (mig 180 + backfill).
// Read-only. For EVERY job: the new resolver (lib/destinations) must return the
// exact address the legacy chain shows today (type_meta.venue_address ||
// clients.shipping_address). Demand zero deltas before any reader cuts over.
// Run: npx tsx scripts/verify-destinations.ts
import { createClient } from "@supabase/supabase-js";
import * as dotenv from "dotenv";
import { resolveJobShipTo, loadLocations } from "../lib/destinations";
dotenv.config({ path: ".env.local", quiet: true } as any);
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const norm = (s: any) => String(s || "").replace(/\s+/g, " ").trim();

(async () => {
  let jobs: any[] = [];
  for (let f = 0; ; f += 1000) {
    const { data, error } = await sb.from("jobs").select("id, job_number, client_id, ship_to_location_id, type_meta, clients(shipping_address)").range(f, f + 999);
    if (error) throw new Error(error.message);
    jobs = jobs.concat(data || []); if (!data || data.length < 1000) break;
  }
  const locCache = new Map<string, any[]>();
  let ok = 0, deltas: string[] = [], viaLegacy = 0, unset = 0;
  for (const j of jobs) {
    const key = `${j.client_id}::${j.id}`;
    const locs = locCache.get(key) ?? await loadLocations(sb, j.client_id, j.id); locCache.set(key, locs);
    const got = resolveJobShipTo(j, locs);
    const legacy = norm(j.type_meta?.venue_address || (j.clients as any)?.shipping_address);
    if (!j.ship_to_location_id && legacy) unset++;
    if (got && got.locationId === null) viaLegacy++;
    if (norm(got?.address) === legacy) ok++;
    else deltas.push(`${j.job_number}: new="${norm(got?.address).slice(0, 50)}" legacy="${legacy.slice(0, 50)}"`);
  }
  console.log(`jobs ${jobs.length} · match ${ok} · DELTAS ${deltas.length} · resolved via legacy fallback ${viaLegacy} · unset-with-address ${unset}`);
  for (const d of deltas.slice(0, 20)) console.log("  Δ", d);
  process.exit(deltas.length ? 1 : 0);
})();
