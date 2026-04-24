#!/usr/bin/env node
/**
 * Delete buy_sheet_lines rows whose size is no longer on the parent
 * item's buy_sheet_lines "current set." Ah wait — sizes come from the
 * lines themselves. The real signal we want is:
 *
 *   "Line rows that exist for a size that has qty_ordered > 0 AND
 *    sibling rows exist for other sizes on the same item, and THIS
 *    row has qty_ordered > 0 but still represents a since-removed
 *    size."
 *
 * Too ambiguous. Simpler rule for the known regression:
 *   An item whose buy_sheet_lines contains BOTH "OSFA" AND any of
 *   S/M/L/XL/2XL/3XL/4XL/5XL/6XL/XS/XXL — almost certainly means the
 *   user reassigned sizes and the OSFA row was left behind. Delete
 *   the OSFA row in that case.
 *
 * Usage:
 *   node scripts/prune-stale-buy-sheet-lines.js           # dry run
 *   node scripts/prune-stale-buy-sheet-lines.js --apply   # delete
 */

const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: ".env.local" });

const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const REAL_SIZES = new Set(["XS", "S", "M", "L", "XL", "2XL", "3XL", "4XL", "5XL", "6XL", "XXL", "XXXL"]);

(async () => {
  console.log(APPLY ? "APPLYING.\n" : "DRY RUN — use --apply to delete.\n");

  const { data: lines } = await sb.from("buy_sheet_lines")
    .select("id, item_id, size, qty_ordered");

  const byItem = new Map();
  for (const l of lines || []) {
    if (!byItem.has(l.item_id)) byItem.set(l.item_id, []);
    byItem.get(l.item_id).push(l);
  }

  const staleIds = [];
  for (const [itemId, rows] of byItem) {
    const hasOsfa = rows.some(r => r.size === "OSFA" || r.size === "ONE SIZE" || r.size === "One Size");
    const hasReal = rows.some(r => REAL_SIZES.has(r.size));
    if (hasOsfa && hasReal) {
      for (const r of rows) {
        if (r.size === "OSFA" || r.size === "ONE SIZE" || r.size === "One Size") staleIds.push(r);
      }
    }
  }

  if (staleIds.length === 0) {
    console.log("No stale OSFA/ONE SIZE rows found alongside real sizes. Clean.");
    return;
  }

  // Fetch item names for logging
  const itemIds = [...new Set(staleIds.map(r => r.item_id))];
  const { data: items } = await sb.from("items").select("id, name, job_id").in("id", itemIds);
  const { data: jobs } = await sb.from("jobs").select("id, title").in("id", [...new Set((items || []).map(i => i.job_id))]);
  const itemMap = new Map((items || []).map(i => [i.id, i]));
  const jobMap = new Map((jobs || []).map(j => [j.id, j.title]));

  console.log(`Found ${staleIds.length} stale row(s) across ${itemIds.length} item(s):\n`);
  for (const r of staleIds) {
    const it = itemMap.get(r.item_id);
    const jobTitle = it ? jobMap.get(it.job_id) || "?" : "?";
    console.log(`  ${jobTitle} · "${it?.name || "?"}"  →  size=${r.size}, qty=${r.qty_ordered}`);
  }

  if (!APPLY) {
    console.log("\nDry run complete. Re-run with --apply to delete.");
    return;
  }

  const ids = staleIds.map(r => r.id);
  const { error } = await sb.from("buy_sheet_lines").delete().in("id", ids);
  if (error) { console.error("Delete failed:", error.message); process.exit(1); }
  console.log(`\n✓ Deleted ${ids.length} stale row(s).`);
})().catch(e => { console.error(e); process.exit(1); });
