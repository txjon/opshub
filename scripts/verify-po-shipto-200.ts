// Mig 200 guard: splitting addresses into parts must NOT change what a PO
// ships to. Snapshot every open job's vendor-paper ship-to (the exact
// resolver the PO PDF uses) before the backfill, re-run after, and diff.
//   npx tsx --env-file=.env.local scripts/verify-po-shipto-200.ts snapshot <file>
//   npx tsx --env-file=.env.local scripts/verify-po-shipto-200.ts compare <file>
// Allowed difference: formatting of the SAME address (spacing, "USA", "Fl"→"FL",
// trailing commas). Anything else — or HPD dock ↔ client flipping — fails.
import fs from "fs";
import { createClient } from "@supabase/supabase-js";
import { vendorPaperShipTo } from "../lib/destinations";

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const [mode, file] = process.argv.slice(2);
const HPD = "<<HPD DOCK>>";
const norm = (s: string) => String(s || "").toLowerCase().replace(/\b(usa|united states)\b/g, "").replace(/[^a-z0-9]/g, "");

(async () => {
  const jobs: any[] = [];
  for (let f = 0; ; f += 500) {
    const { data, error } = await db.from("jobs").select("id, job_number, shipping_route, phase, items(id, shipping_route)").not("phase", "in", "(complete,cancelled)").order("id").range(f, f + 499);
    if (error) throw error; jobs.push(...(data || [])); if (!data || data.length < 500) break;
  }
  const { data: decs } = await db.from("decorators").select("default_shipping_route");
  const vendorRoutes = Array.from(new Set([null, ...((decs || []) as any[]).map(d => d.default_shipping_route).filter(Boolean)]));
  const out: Record<string, any> = {};
  for (const j of jobs) {
    const items = (j.items || []) as any[];
    if (!items.length) continue;
    for (const vr of vendorRoutes) {
      const vendorDefaultRoute = j.shipping_route === "drop_ship" ? vr : null;
      const groups: [string, any[]][] = [["all", items], ...items.map(i => [i.id, [i]] as [string, any[]])];
      for (const [g, its] of groups) {
        const p = await vendorPaperShipTo(db, { jobId: j.id, jobRoute: j.shipping_route, vendorItems: its, vendorDefaultRoute, hpdBlock: HPD });
        out[`${j.job_number}|${vr}|${g}`] = {
          route: j.shipping_route,
          header: p.address === HPD ? "HPD" : p.address,
          perItem: Object.fromEntries(Array.from(p.perItem.entries()).map(([k, ds]) => [k, ds.map(d => ({ loc: d.locationId, address: d.address }))])),
        };
      }
    }
  }
  if (mode === "snapshot") { fs.writeFileSync(file, JSON.stringify(out)); console.log(`snapshot: ${Object.keys(out).length} PO ship-to cases across ${jobs.length} open jobs`); return; }
  const before = JSON.parse(fs.readFileSync(file, "utf8"));
  let same = 0, cosmetic = 0; const bad: string[] = [];
  for (const k of new Set([...Object.keys(before), ...Object.keys(out)])) {
    const a = before[k], b = out[k];
    if (!a || !b) { bad.push(`${k}: case ${a ? "disappeared" : "is new"}`); continue; }
    if (JSON.stringify(a) === JSON.stringify(b)) { same++; continue; }
    if ((a.header === "HPD") !== (b.header === "HPD")) { bad.push(`${k}: HPD dock ↔ client FLIPPED`); continue; }
    const strip = (x: any) => JSON.stringify({ h: norm(x.header), p: Object.fromEntries(Object.entries(x.perItem).map(([i, ds]: any) => [i, ds.map((d: any) => [d.loc, norm(d.address)])])) });
    if (strip(a) === strip(b)) { cosmetic++; continue; }
    bad.push(`${k}: ${JSON.stringify(a.header)} → ${JSON.stringify(b.header)}`);
  }
  const hpd = Object.values(out).filter((x: any) => x.header === "HPD").length;
  console.log(`${same} identical, ${cosmetic} same address re-formatted, ${bad.length} REAL differences (${hpd} cases print the HPD dock)`);
  bad.slice(0, 40).forEach(b => console.log("  ✗", b));
  if (bad.length) process.exit(1);
})().catch(e => { console.error(e); process.exit(1); });
