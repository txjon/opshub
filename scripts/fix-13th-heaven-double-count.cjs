#!/usr/bin/env node
/**
 * Correction to the 2026-07-16 master-waybill rebuild: the deleted
 * "Multiple - See attachment" box left its three ship movements standing
 * (the ledger is append-only), double-counting every pant. Reverse exactly
 * those three (negation + reverses_id, the standard undo convention),
 * recompute the item caches, and set final item states:
 *   Olive 698/691 → closed · Crocodile 232/227 → closed · Fossil 505/526 → open.
 *
 * Usage: npx -y tsx scripts/fix-13th-heaven-double-count.cjs [--apply]
 */
require("dotenv").config({ path: ".env.local" });
const { createClient } = require("@supabase/supabase-js");
const APPLY = process.argv.includes("--apply");
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sum = (q) => Object.values(q || {}).reduce((a, v) => a + (Number(v) || 0), 0);

async function main() {
  const { appendMovement, recomputeItemFromLedger } = await import("../lib/inventory-ledger.ts");
  const { recalcJobPhase } = await import("../lib/job-phase-recalc.ts");

  const { data: job } = await sb.from("jobs").select("id").eq("job_number", "HPD-2606-040").single();
  const { data: movs } = await sb.from("movements")
    .select("id, item_id, job_id, type, qtys, description, reverses_id")
    .eq("job_id", job.id).eq("type", "ship").eq("tracking", "Multiple - See attachment");
  const reversedIds = new Set((await sb.from("movements").select("reverses_id").eq("job_id", job.id).not("reverses_id", "is", null)).data?.map((m) => m.reverses_id));
  const targets = (movs || []).filter((m) => !m.reverses_id && !reversedIds.has(m.id));
  if (targets.length !== 3) throw new Error(`expected 3 un-reversed 'Multiple' ship movements, found ${targets.length} — aborting`);
  for (const t of targets) console.log(`will reverse: ${t.description} ship ${sum(t.qtys)}u`);
  if (!APPLY) { console.log("\nDry run — --apply to execute."); return; }

  for (const t of targets) {
    const negation = Object.fromEntries(Object.entries(t.qtys || {}).map(([s, n]) => [s, -(Number(n) || 0)]));
    await appendMovement(sb, {
      itemId: t.item_id, jobId: t.job_id, type: "ship", qtys: negation,
      reason: "Rebuild correction — box replaced by 7 master-waybill boxes", reversesId: t.id, description: t.description,
    });
    await recomputeItemFromLedger(sb, t.item_id);
  }

  // final item state: closed = shipped covers ordered (ordered deduped by size,
  // same map recompute uses — NOT a raw row sum, buy_sheet_lines has dupes)
  for (const t of targets) {
    const { data: it } = await sb.from("items")
      .select("name, ship_qtys, buy_sheet_lines(size, qty_ordered), decorator_assignments(id)").eq("id", t.item_id).single();
    const orderedMap = Object.fromEntries((it.buy_sheet_lines || []).map((l) => [l.size, Number(l.qty_ordered) || 0]));
    const shipped = sum(it.ship_qtys), ordered = sum(orderedMap);
    const closed = ordered > 0 && shipped >= ordered;
    await sb.from("items").update({ ship_final: closed, pipeline_stage: closed ? "shipped" : "in_production" }).eq("id", t.item_id);
    const daId = it.decorator_assignments?.[0]?.id;
    if (daId) await sb.from("decorator_assignments").update({ pipeline_stage: closed ? "shipped" : "in_production" }).eq("id", daId);
    console.log(`${it.name}: shipped ${shipped}/${ordered} → ${closed ? "closed (shipped)" : "open (more owed)"}`);
  }

  await recalcJobPhase(sb, job.id);
  const { data: check } = await sb.from("items").select("name, ship_qtys").eq("job_id", job.id).in("id", targets.map((t) => t.item_id));
  console.log("\nship_qtys caches now:", check.map((i) => `${i.name.split(" ")[0]} ${sum(i.ship_qtys)}`).join(" · "));
}
main().catch((e) => { console.error("ABORT:", e.message); process.exit(1); });
