#!/usr/bin/env node
// Run ONCE at push time with the split-shipments code (mig 180): flips the
// vendor→client boxes written before the cutover from direction 'inbound' to
// 'direct'. Prod readers on main filter direction='inbound' until the code
// that reads 'direct' is deployed — so this runs WITH that deploy, not before.
// Idempotent. Dry run without --write.
require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WRITE = process.argv.includes("--write");
async function all(q) { let out = []; for (let f = 0; ; f += 1000) { const { data, error } = await q(f, f + 999); if (error) throw new Error(error.message); out = out.concat(data || []); if (!data || data.length < 1000) break; } return out; }
(async () => {
  const ships = await all((f, t) => sb.from("shipments").select("id").eq("direction", "inbound").range(f, t));
  const lines = await all((f, t) => sb.from("shipment_lines").select("shipment_id, items(shipping_route, jobs(shipping_route))").in("shipment_id", ships.map(s => s.id)).range(f, t));
  const byShip = new Map();
  for (const l of lines) { const a = byShip.get(l.shipment_id) || []; a.push(l); byShip.set(l.shipment_id, a); }
  const route = l => l.items?.shipping_route || l.items?.jobs?.shipping_route || "ship_through";
  const direct = ships.filter(s => { const ls = byShip.get(s.id) || []; return ls.length > 0 && ls.every(l => route(l) === "drop_ship"); });
  const mixed = ships.filter(s => { const ls = byShip.get(s.id) || []; return ls.some(l => route(l) === "drop_ship") && !ls.every(l => route(l) === "drop_ship"); });
  console.log(`inbound boxes ${ships.length} · all-drop-ship → direct ${direct.length} · mixed (left alone) ${mixed.length}`);
  if (WRITE) for (const s of direct) { const { error } = await sb.from("shipments").update({ direction: "direct" }).eq("id", s.id); if (error) throw new Error(error.message); }
  console.log(WRITE ? "✓ flipped" : "(dry run — add --write)");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
