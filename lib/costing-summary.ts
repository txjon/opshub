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

// ── Single-source overlay ───────────────────────────────────────────────────
// costing_data.costProds carries VESTIGIAL qtys/blankCosts that drift once
// quantities live in buy_sheet_lines and blank costs in items.blank_costs
// (the 028 class — the hub showed $3,575 while the buy sheet said $2,472).
// Before any computation, overlay each costProd with the item truth:
//   qty ← buy_sheet_lines (fallback: costProd qtys when no lines)
//   blankCosts ← items.blank_costs (fallback: costProd blankCosts)
// costProds matching NO item are dropped — the buy sheet owns which products
// exist; a lingering costProd for a removed item must not inflate totals.
export function overlayCostProds(costProds: any[], items: any[]): any[] {
  if (!items?.length) return costProds; // legacy safety: no item rows → leave as-is
  const byId = new Map(items.map((it: any) => [it.id, it]));
  const byName = new Map(items.map((it: any) => [(it.name || "").trim().toLowerCase(), it]));
  const out: any[] = [];
  for (const p of costProds || []) {
    const it: any = byId.get(p.id) || byName.get((p.name || "").trim().toLowerCase());
    if (!it) continue;
    const lines = it.buy_sheet_lines || [];
    const bslQtys = Object.fromEntries(lines.map((l: any) => [l.size, Number(l.qty_ordered) || 0]));
    const qtys = lines.length ? bslQtys : (p.qtys || {});
    const totalQty = Object.values(qtys).reduce((a: number, v: any) => a + (Number(v) || 0), 0);
    const blankCosts = (it.blank_costs && Object.keys(it.blank_costs).length) ? it.blank_costs : (p.blankCosts || {});
    out.push({ ...p, qtys, totalQty, blankCosts });
  }
  return out;
}

// Fetch the item truth needed by overlayCostProds.
async function loadItemTruth(sb: Sb, jobId: string): Promise<any[]> {
  const { data } = await sb.from("items").select("id, name, blank_costs, buy_sheet_lines(size, qty_ordered)").eq("job_id", jobId);
  return data || [];
}

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
  const itemTruth = await loadItemTruth(sb, jobId);
  const overlaid = { ...job.costing_data, costProds: overlayCostProds(job.costing_data.costProds, itemTruth) };
  const summary = computeCostingSummary(overlaid, job.type_meta?.invoice_extra_lines, printers);
  if (!summary) return { ok: true, reason: "no computable products" };
  const { error } = await sb.from("jobs").update({ costing_summary: summary }).eq("id", jobId);
  if (error) return { ok: false, reason: error.message };
  return { ok: true, summary };
}

// ── PO-send cost snapshot (Tier 2) ──────────────────────────────────────────
// Freeze THIS vendor's expected costs at the moment a PO goes out, into
// type_meta.po_cost_snapshots[vendor]. Purpose: (1) billing/variance baselines
// stop floating with later rate-card edits ("a rate change rewrites history"),
// (2) revised POs can diff lines against the original send (line-level
// REVISED markers), (3) god-mode can read snapshots instead of re-running the
// pricing engine over all history. Capture-only for now — consumers wire in
// later; every send from tonight accrues history.
export async function snapshotVendorPo(sb: Sb, jobId: string, vendorName: string): Promise<{ ok: boolean; reason?: string }> {
  const { data: job } = await sb.from("jobs").select("id, costing_data, type_meta").eq("id", jobId).single();
  if (!job?.costing_data?.costProds?.length) return { ok: false, reason: "no costing data" };
  const { data: decorators } = await sb.from("decorators").select("*");
  const printers = buildPrintersMap(decorators || []);
  const { costMargin, inclShip, inclCC } = job.costing_data;
  // Same single-source overlay as the summary — a PO snapshot must freeze the
  // REAL quantities, not costing_data's vestigial ones.
  const costProds = overlayCostProds(job.costing_data.costProds, await loadItemTruth(sb, jobId));
  const vendorProds = (costProds as any[]).filter(p => (p.printVendor || "") === vendorName);
  if (!vendorProds.length) return { ok: false, reason: "no items for vendor" };
  const items = vendorProds.map((p: any) => {
    const r = calcCostProduct(p, costMargin, inclShip, inclCC, costProds, printers);
    if (!r) return null;
    return {
      id: p.id, name: p.name || "", qty: r.qty,
      poTotal: Math.round((Number(r.poTotal) || 0) * 100) / 100,
      sellPerUnit: Math.round((Number(r.sellPerUnit) || 0) * 100) / 100,
      blankCost: Math.round((Number(r.blankCost) || 0) * 100) / 100,
      passthrough: !!p.passthrough,
    };
  }).filter(Boolean) as any[];
  const vendorPoTotal = Math.round(items.reduce((a, i) => a + i.poTotal, 0) * 100) / 100;
  const snapshot = { at: new Date().toISOString(), items, vendorPoTotal };
  const tm = { ...(job.type_meta || {}) };
  tm.po_cost_snapshots = { ...(tm.po_cost_snapshots || {}), [vendorName]: snapshot };
  const { error } = await sb.from("jobs").update({ type_meta: tm }).eq("id", jobId);
  return error ? { ok: false, reason: error.message } : { ok: true };
}
