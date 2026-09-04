// PARITY HARNESS — single-source Phase 4 (Sep 4 2026). READ-ONLY.
// Computes, for every job with a costing run, the variance board's blank
// projection (blankCalc) and the freight estimate three ways:
//   RAW        — costing_data.costProds as stored (today's behavior)
//   QTY-ONLY   — overlay quantities from buy_sheet_lines, blank costs untouched
//   FULL       — overlayCostProds (qty ← bsl, blankCosts ← items.blank_costs)
// Delta attribution isolates the blank-cost contribution (Jon's fear) from
// the quantity fix. Zero unexplained deltas = the flip is safe to ship.
// Run: npx tsx scripts/verify-qty-single-source.ts
import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";
import { calcCostProduct, buildPrintersMap, effectiveShipRate } from "../lib/pricing";
import { overlayCostProds } from "../lib/costing-summary";

const r2 = (n: number) => Math.round(n * 100) / 100;

async function all(sb: any, table: string, sel: string, filt?: (q: any) => any) {
  let out: any[] = [], from = 0;
  for (;;) {
    let q = sb.from(table).select(sel).range(from, from + 999);
    if (filt) q = filt(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out = out.concat(data);
    if (data.length < 1000) return out;
    from += 1000;
  }
}

function blankCalc(cps: any[], margin: string, printers: any): number {
  return r2(cps.reduce((s, c) => {
    const calc = calcCostProduct(c, margin, false, false, cps, printers);
    return s + (calc ? Number(calc.blankCost || 0) : 0);
  }, 0));
}
function freightCalc(cps: any[]): number {
  let total = 0;
  for (const cp of cps) {
    const qty = cp.totalQty || Object.values(cp.qtys || {}).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    total += effectiveShipRate(cp) * qty;
  }
  return r2(total);
}
// Qty-only overlay: buy-sheet quantities in, stored blank costs kept.
function qtyOnlyOverlay(cps: any[], items: any[]): any[] {
  const full = overlayCostProds(cps, items);
  const stored = new Map(cps.map((p: any) => [p.id, p]));
  return full.map(p => ({ ...p, blankCosts: (stored.get(p.id) || p).blankCosts }));
}

async function main() {
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const jobs = await all(sb, "jobs", "id, job_number, phase, costing_data", (q: any) => q.not("costing_data", "is", null).not("phase", "eq", "cancelled"));
  const items = await all(sb, "items", "id, job_id, name, sort_order, blank_costs, sell_per_unit, buy_sheet_lines(size, qty_ordered)");
  const { data: decorators } = await sb.from("decorators").select("id, name, short_code, pricing_data, capabilities");
  const printers = buildPrintersMap((decorators || []) as any[]);
  const itemsBy: Record<string, any[]> = {};
  for (const it of items) (itemsBy[it.job_id] ||= []).push(it);

  let clean = 0, qtyDeltas = 0, blankDeltas = 0, freightDeltas = 0;
  const rows: string[] = [];
  for (const j of jobs) {
    const cps = j.costing_data?.costProds || [];
    if (!cps.length) continue;
    const margin = String(j.costing_data?.margin ?? j.costing_data?.costMargin ?? 0);
    const its = itemsBy[j.id] || [];
    const raw = blankCalc(cps, margin, printers);
    const qtyOnly = blankCalc(qtyOnlyOverlay(cps, its), margin, printers);
    const full = blankCalc(overlayCostProds(cps, its), margin, printers);
    const fRaw = freightCalc(cps);
    const fFull = freightCalc(overlayCostProds(cps, its));
    const dQty = r2(qtyOnly - raw);          // the quantity fix
    const dBlank = r2(full - qtyOnly);       // the blank-cost contribution (fear zone)
    const dFreight = r2(fFull - fRaw);
    if (Math.abs(dQty) < 0.01 && Math.abs(dBlank) < 0.01 && Math.abs(dFreight) < 0.01) { clean++; continue; }
    if (Math.abs(dQty) >= 0.01) qtyDeltas++;
    if (Math.abs(dBlank) >= 0.01) blankDeltas++;
    if (Math.abs(dFreight) >= 0.01) freightDeltas++;
    rows.push(`${j.job_number.padEnd(14)} ${j.phase.padEnd(12)} blank: ${String(raw).padStart(9)} → ${String(full).padStart(9)}  (qty ${dQty >= 0 ? "+" : ""}${dQty} · blankCost ${dBlank >= 0 ? "+" : ""}${dBlank})  freight Δ ${dFreight >= 0 ? "+" : ""}${dFreight}`);
  }
  console.log(`\n${clean} jobs byte-identical all three ways`);
  console.log(`${qtyDeltas} jobs move on the QTY flip · ${blankDeltas} jobs move on the BLANK-COST flip · ${freightDeltas} freight deltas\n`);
  for (const r of rows) console.log(r);
}
main().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
