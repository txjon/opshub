#!/usr/bin/env node
// Map ap_vendors.qb_vendor_id via QB vendor search (drawer item, needed by
// the bill linker). Exact/close name matches auto-apply; ambiguous reported.
// Dry-run by default: npx -y tsx scripts/map-qb-vendors.cjs [--apply]
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const norm = (s) => (s || "").toLowerCase().replace(/[.,']/g, "").replace(/\b(llc|ltd|inc|co|dba|the)\b/g, "").replace(/\s+/g, " ").trim();
async function main() {
  const { findVendorCandidates } = await import("../lib/quickbooks.ts");
  const { data: vendors } = await sb.from("ap_vendors").select("id, name, qb_vendor_id, match_keys").is("qb_vendor_id", null);
  console.log(`${(vendors || []).length} ap_vendors without qb_vendor_id`);
  for (const v of vendors || []) {
    const tries = [v.name, ...(v.match_keys || [])].filter(Boolean);
    let found = null, how = "";
    for (const t of tries) {
      const cands = await findVendorCandidates(t, 10).catch(() => []);
      const exact = cands.filter(c => norm(c.DisplayName) === norm(t) || norm(c.DisplayName) === norm(v.name));
      if (exact.length === 1) { found = exact[0]; how = `exact ~ "${t}"`; break; }
      const contains = cands.filter(c => norm(c.DisplayName).includes(norm(t)) || norm(t).includes(norm(c.DisplayName)));
      if (contains.length === 1 && !found) { found = contains[0]; how = `contains ~ "${t}"`; }
    }
    if (found) {
      console.log(`  ${v.name} → QB "${found.DisplayName}" (${found.Id}) via ${how}`);
      if (APPLY) await sb.from("ap_vendors").update({ qb_vendor_id: String(found.Id) }).eq("id", v.id);
    } else {
      console.log(`  ${v.name} → NO MATCH (tried: ${tries.join(", ")})`);
    }
  }
  if (!APPLY) console.log("\nDry run — --apply to stamp qb_vendor_id on the matches above.");
}
main().catch(e => { console.error("ABORT:", e.message); process.exit(1); });
