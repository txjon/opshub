// THE server-side mirror of CostingTab's costing_summary computation
// (roadmap Tier 2, 2026-07-17). Root problem: only CostingTab wrote the
// summary, so any ProductBuilder mutation (qtys, add/remove, blank swap,
// size subs) left every dollar KPI stale until someone re-opened Costing.
//
// This mirrors CostingTab.onSave's aggregation EXACTLY (same engine —
// lib/pricing calcCostProduct — same rounding, same passthrough split).
// Verified against every stored summary by scripts/verify-costing-summary.cjs
// before any caller was wired. If CostingTab's aggregation ever changes,
// change THIS file in the same commit (single-source extraction into
// CostingTab itself is queued for the Job Page V2 rebuild).

import { calcCostProduct, buildPrintersMap } from "./pricing";

type Sb = any;

// Split Additional charges into HPD revenue vs $0-margin passthrough —
// identical to CostingTab's computeExtraSummary.
export function computeExtraSummary(lines: any[] | null | undefined): { feeRevenue: number; passthruTotal: number } {
  let feeRevenue = 0, passthruTotal = 0;
  for (const l of (lines || [])) {
    const amt = Number(l?.amount) || 0;
    if (l?.type === "passthru") passthruTotal += amt; else feeRevenue += amt;
  }
  return { feeRevenue: Math.round(feeRevenue * 100) / 100, passthruTotal: Math.round(passthruTotal * 100) / 100 };
}

export function computeCostingSummary(costingData: any, invoiceExtraLines: any[] | null | undefined, printers: Record<string, any>) {
  const costProds: any[] = costingData?.costProds || [];
  const { costMargin, inclShip, inclCC } = costingData || {};
  if (!costProds.length) return null;

  const rawResults = costProds
    .map((p: any, idx: number) => { const r = calcCostProduct(p, costMargin, inclShip, inclCC, costProds, printers); return r ? { ...r, _idx: idx } : null; })
    .filter(Boolean) as any[];
  // Round sellPerUnit to cent first, then derive grossRev — matches items.sell_per_unit
  const results = rawResults.map(r => ({ ...r, sellPerUnit: Math.round(r.sellPerUnit * 100) / 100, grossRev: Math.round(Math.round(r.sellPerUnit * 100) / 100 * r.qty * 100) / 100 }));
  const isPT = (r: any) => !!costProds[r._idx]?.passthrough;
  const realResults = results.filter(r => !isPT(r));
  const grossRev = Math.round(realResults.reduce((a, r) => a + r.grossRev, 0) * 100) / 100;
  const totalCost = Math.round(realResults.reduce((a, r) => a + r.totalCost, 0) * 100) / 100;
  const passthruProducts = Math.round(results.filter(isPT).reduce((a, r) => a + r.grossRev, 0) * 100) / 100;
  const netProfit = Math.round((grossRev - totalCost) * 100) / 100;
  const totalQty = results.reduce((a, r) => a + r.qty, 0);
  const realQty = realResults.reduce((a, r) => a + r.qty, 0);
  const margin = grossRev > 0 ? netProfit / grossRev * 100 : 0;
  const avgPerUnit = realQty > 0 ? grossRev / realQty : 0;
  const { feeRevenue, passthruTotal: extraPassthru } = computeExtraSummary(invoiceExtraLines);
  const passthruTotal = Math.round((extraPassthru + passthruProducts) * 100) / 100;
  return { grossRev, totalCost, netProfit, margin, avgPerUnit, totalQty, feeRevenue, passthruTotal };
}

// Recompute + persist a job's costing_summary from its saved costing_data.
// Writes ONLY the summary (a derived cache) — never touches costing_data.
// No-op for jobs with no costing run.
export async function refreshJobFinancials(sb: Sb, jobId: string): Promise<{ ok: boolean; summary?: any; reason?: string }> {
  const { data: job } = await sb.from("jobs")
    .select("id, costing_data, type_meta, costing_summary").eq("id", jobId).single();
  if (!job) return { ok: false, reason: "no such job" };
  if (!job.costing_data?.costProds?.length) return { ok: true, reason: "no costing run — left untouched" };
  const { data: decorators } = await sb.from("decorators").select("*");
  const printers = buildPrintersMap(decorators || []);
  const summary = computeCostingSummary(job.costing_data, job.type_meta?.invoice_extra_lines, printers);
  if (!summary) return { ok: true, reason: "no computable products" };
  const { error } = await sb.from("jobs").update({ costing_summary: summary }).eq("id", jobId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, summary };
}
