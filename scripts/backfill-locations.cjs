#!/usr/bin/env node
// Backfill for mig 180 (split shipments foundation). Idempotent; safe to re-run.
//   1. every client with a shipping_address → one "Main" book entry (is_default)
//   2. every job → ship_to_location_id: the client's Main, or a job-scoped
//      "Project address" entry when type_meta.venue_address differs from Main
//   3. vendor→client boxes (all lines drop_ship) → direction 'direct'
// Run:  node scripts/backfill-locations.cjs            (dry run, prints the plan)
//       node scripts/backfill-locations.cjs --write              (steps 1+2, additive)
//       node scripts/backfill-locations.cjs --write --direction  (+ step 3: run WITH the
//         code that reads 'direct', i.e. at push time — prod readers on main still
//         filter direction='inbound' until then)
require("dotenv").config({ path: ".env.local", quiet: true });
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const WRITE = process.argv.includes("--write");
const DIRECTION = process.argv.includes("--direction");
const norm = s => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
async function all(q) { let out = []; for (let f = 0; ; f += 1000) { const { data, error } = await q(f, f + 999); if (error) throw new Error(error.message); out = out.concat(data || []); if (!data || data.length < 1000) break; } return out; }

(async () => {
  const clients = await all((f, t) => sb.from("clients").select("id, name, company_id, shipping_address").range(f, t));
  const existing = await all((f, t) => sb.from("client_locations").select("id, client_id, job_id, label, address, is_default").range(f, t));
  const mainByClient = new Map(existing.filter(l => l.is_default && !l.job_id).map(l => [l.client_id, l]));
  const jobLoc = new Map(existing.filter(l => l.job_id).map(l => [l.job_id, l]));

  // 1. Main per client
  let mainsToCreate = [];
  for (const c of clients) {
    if (mainByClient.has(c.id)) continue;
    if (!norm(c.shipping_address)) continue;
    mainsToCreate.push({ client_id: c.id, company_id: c.company_id, label: "Main", address: c.shipping_address.trim(), is_default: true });
  }
  console.log(`clients ${clients.length} · Main entries already ${mainByClient.size} · to create ${mainsToCreate.length} · no address ${clients.filter(c => !norm(c.shipping_address)).length}`);
  if (!WRITE) for (const m of mainsToCreate) mainByClient.set(m.client_id, { ...m, id: "(new)" });   // simulate for the plan
  if (WRITE && mainsToCreate.length) {
    for (let i = 0; i < mainsToCreate.length; i += 200) {
      const { data, error } = await sb.from("client_locations").insert(mainsToCreate.slice(i, i + 200)).select("id, client_id, label, address, is_default, job_id");
      if (error) throw new Error("Main insert: " + error.message);
      for (const l of data) mainByClient.set(l.client_id, l);
    }
  }

  // 2. job default destination
  const jobs = await all((f, t) => sb.from("jobs").select("id, job_number, client_id, company_id, ship_to_location_id, type_meta").range(f, t));
  let useMain = 0, custom = 0, noAddr = 0, already = 0, noClient = 0;
  const customRows = [], mainAssign = [];
  for (const j of jobs) {
    if (j.ship_to_location_id) { already++; continue; }
    if (!j.client_id) { noClient++; continue; }
    const main = mainByClient.get(j.client_id);
    const venue = String(j.type_meta?.venue_address || "").trim();
    if (venue && (!main || norm(venue) !== norm(main.address))) {
      custom++;
      const have = jobLoc.get(j.id);
      customRows.push({ job: j, row: have || { client_id: j.client_id, company_id: j.company_id, job_id: j.id, label: "Project address", address: venue, is_default: false } });
    } else if (main) { useMain++; mainAssign.push({ job: j, locId: main.id }); }
    else noAddr++;
  }
  console.log(`jobs ${jobs.length} · already set ${already} · → Main ${useMain} · → project address ${custom} · no address anywhere ${noAddr} · no client ${noClient}`);
  for (const c of customRows.slice(0, 5)) console.log("  custom:", c.job.job_number, "|", norm(c.row.address).slice(0, 60));
  if (WRITE) {
    for (const { job, locId } of mainAssign) {
      const { error } = await sb.from("jobs").update({ ship_to_location_id: locId }).eq("id", job.id);
      if (error) throw new Error("job update: " + error.message);
    }
    for (const { job, row } of customRows) {
      let id = row.id;
      if (!id) {
        const { data, error } = await sb.from("client_locations").insert(row).select("id").single();
        if (error) throw new Error("project address insert: " + error.message);
        id = data.id;
      }
      const { error } = await sb.from("jobs").update({ ship_to_location_id: id }).eq("id", job.id);
      if (error) throw new Error("job update: " + error.message);
    }
  }

  // 3. vendor→client boxes → 'direct'
  const ships = await all((f, t) => sb.from("shipments").select("id, direction, decorator_id").eq("direction", "inbound").range(f, t));
  const lines = await all((f, t) => sb.from("shipment_lines").select("shipment_id, item_id, items(shipping_route, jobs(shipping_route))").in("shipment_id", ships.map(s => s.id)).range(f, t));
  const byShip = new Map();
  for (const l of lines) { const a = byShip.get(l.shipment_id) || []; a.push(l); byShip.set(l.shipment_id, a); }
  const route = l => l.items?.shipping_route || l.items?.jobs?.shipping_route || "ship_through";
  const direct = ships.filter(s => { const ls = byShip.get(s.id) || []; return ls.length > 0 && ls.every(l => route(l) === "drop_ship"); });
  const mixed = ships.filter(s => { const ls = byShip.get(s.id) || []; return ls.some(l => route(l) === "drop_ship") && !ls.every(l => route(l) === "drop_ship"); });
  console.log(`inbound boxes ${ships.length} · all-drop-ship → direct ${direct.length} · MIXED (left inbound, review) ${mixed.length} ${mixed.map(s => s.id.slice(0, 8)).join(",")}`);
  if (WRITE && DIRECTION && direct.length) {
    for (const s of direct) { const { error } = await sb.from("shipments").update({ direction: "direct" }).eq("id", s.id); if (error) throw new Error("direction: " + error.message); }
  }
  console.log(WRITE ? (DIRECTION ? "✓ written (incl. direction)" : "✓ written (steps 1+2; direction flip deferred — add --direction at push)") : "(dry run — add --write)");
})().catch(e => { console.error("FAILED:", e.message); process.exit(1); });
